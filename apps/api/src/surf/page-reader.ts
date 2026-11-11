import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isPrivateHostname, safeLookup } from "../webpage/service.ts";
import { BrowserManager, sharedBrowser, type BrowserManagerOptions, type InstallStatus } from "./browser.ts";
import { classifyError, SurfError } from "./errors.ts";
import { assertReadable, extractArticle, toWebPage } from "./reader.ts";
import type { WebPageText } from "./types.ts";

/**
 * 读一个网页的完整流程：
 * 1. 先用普通 HTTP 请求抓 HTML（快、不用起浏览器），逐跳校验重定向；
 * 2. 正文够了就直接用 Readability 提取；
 * 3. 不够（脚本渲染的页面、被拦了）才交给浏览器管理器渲染，再提取一次。
 * 没装浏览器时第 3 步自动降级：后台开始安装，这一趟只读得动静态页面。
 */

export interface ReadOptions {
  signal?: AbortSignal;
}

export interface PageReader {
  /** 有没有读网页的能力：静态抓取总是有的，所以这里恒为 true。 */
  available(): Promise<boolean>;
  read(url: string, options?: ReadOptions): Promise<WebPageText>;
  /** 渲染用的浏览器还没就绪时在后台开始安装。 */
  prepare(): void;
  browserStatus(): InstallStatus;
  close(): Promise<void>;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const STATIC_TIMEOUT_MS = 15_000;

export type StaticFetcher = (url: string, options: {
  signal?: AbortSignal;
  allowPrivateHosts?: boolean;
  /** 只给测试用：替换连接时解析地址的 lookup。 */
  lookup?: typeof dnsLookup;
}) => Promise<{ html: string; url: string }>;

interface StaticHop {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const privateAddressError = (error: unknown) => error instanceof Error && /内部地址/.test(error.message);

/**
 * 用 node:http(s) 发一跳请求：lookup 在连接时校验解析出的地址，DNS 重绑定没有先查后连的窗口。
 * 响应流式读取，超过 2 MB 就不再往下读。
 */
function requestStatic(target: URL, options: { signal: AbortSignal; lookup?: typeof dnsLookup }): Promise<StaticHop> {
  return new Promise((resolve, reject) => {
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(target, {
      ...(options.lookup ? { lookup: options.lookup } : {}),
      signal: options.signal,
      headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.5", accept: "text/html,application/xhtml+xml" },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
      };
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        chunks.push(chunk);
        if (size > MAX_HTML_BYTES) {
          finish();
          response.destroy();
        }
      });
      response.on("end", finish);
      response.on("close", finish);
      response.on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
    request.on("error", reject);
    request.end();
  });
}

export const fetchStaticHtml: StaticFetcher = async (url, options) => {
  const lookup = options.allowPrivateHosts ? undefined : (options.lookup ?? safeLookup);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = new URL(current);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new SurfError("content", "只能读 http 或 https 网页。");
    if (!options.allowPrivateHosts && isPrivateHostname(target.hostname)) {
      throw new SurfError("content", "这个地址指向内部网络，不会去读。");
    }
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(STATIC_TIMEOUT_MS)]) : AbortSignal.timeout(STATIC_TIMEOUT_MS);
    let response: StaticHop;
    try {
      response = await requestStatic(target, { signal, lookup });
    } catch (error) {
      if (!options.allowPrivateHosts && privateAddressError(error)) throw new SurfError("content", "这个地址指向内部网络，不会去读。");
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new SurfError("content", "页面重定向没有目的地。");
      current = new URL(location, target).toString();
      continue;
    }
    if (response.status === 429) throw new SurfError("rate_limit", "对方让我们慢一点（429）。", { status: 429 });
    if (response.status < 200 || response.status >= 300) throw new SurfError(response.status >= 500 ? "network" : "content", `页面返回了 ${response.status}。`, { status: response.status });
    const type = String(response.headers["content-type"] ?? "");
    if (type && !/html|xml/i.test(type)) throw new SurfError("content", "这不是一个网页。");
    const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? "utf-8";
    let html: string;
    try {
      html = new TextDecoder(charset).decode(response.body);
    } catch {
      html = new TextDecoder("utf-8").decode(response.body);
    }
    return { html, url: target.toString() };
  }
  throw new SurfError("content", "页面重定向太多次。");
};

export interface PageReaderOptions extends BrowserManagerOptions {
  /** 用现成的浏览器管理器（默认共享单例）。 */
  browser?: BrowserManager;
  fetchStatic?: StaticFetcher;
}

export function createPageReader(options: PageReaderOptions = {}): PageReader {
  const browser = options.browser ?? sharedBrowser(options);
  const fetchStatic = options.fetchStatic ?? fetchStaticHtml;

  return {
    async available() {
      return true;
    },

    prepare() {
      browser.prepare();
    },

    browserStatus() {
      return browser.installStatus();
    },

    async read(url, readOptions = {}) {
      const { signal } = readOptions;
      let staticError: unknown = null;
      try {
        const fetched = await fetchStatic(url, { signal, allowPrivateHosts: options.allowPrivateHosts });
        const article = extractArticle(fetched.html, fetched.url);
        assertReadable(article);
        return toWebPage(fetched.url, article);
      } catch (error) {
        staticError = error;
        const kind = classifyError(error, signal);
        // 取消、限流、地址不安全：换浏览器也没用，直接抛。
        if (kind === "aborted" || kind === "rate_limit") throw error;
        if (error instanceof SurfError && /内部网络|有效的网页|http 或 https/.test(error.message)) throw error;
      }

      if (!browser.isReady()) {
        browser.prepare();
        // 降级：这一趟读不了脚本渲染的页面，如实报告，不假装读到了。
        throw staticError instanceof SurfError && staticError.kind === "network"
          ? staticError
          : new SurfError("content", "这个网页需要浏览器渲染，浏览器还没准备好，先跳过。", { cause: staticError });
      }
      const rendered = await browser.render(url, { signal });
      const article = extractArticle(rendered.html, rendered.url);
      assertReadable(article);
      return toWebPage(rendered.url, article);
    },

    close() {
      return browser.close();
    },
  };
}
