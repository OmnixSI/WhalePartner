import { BrowserManager, resolvesPublic, sharedBrowser, type BrowserManagerOptions, type InstallStatus } from "./browser.ts";
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

export type StaticFetcher = (url: string, options: { signal?: AbortSignal; allowPrivateHosts?: boolean }) => Promise<{ html: string; url: string }>;

export const fetchStaticHtml: StaticFetcher = async (url, options) => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = new URL(current);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new SurfError("content", "只能读 http 或 https 网页。");
    if (!options.allowPrivateHosts && !(await resolvesPublic(target.hostname.replace(/^\[|\]$/g, "")))) {
      throw new SurfError("content", "这个地址指向内部网络，不会去读。");
    }
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(STATIC_TIMEOUT_MS)]) : AbortSignal.timeout(STATIC_TIMEOUT_MS);
    const response = await fetch(target, {
      redirect: "manual",
      signal,
      headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.5", accept: "text/html,application/xhtml+xml" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new SurfError("content", "页面重定向没有目的地。");
      current = new URL(location, target).toString();
      continue;
    }
    if (response.status === 429) throw new SurfError("rate_limit", "对方让我们慢一点（429）。", { status: 429 });
    if (!response.ok) throw new SurfError(response.status >= 500 ? "network" : "content", `页面返回了 ${response.status}。`, { status: response.status });
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) throw new SurfError("content", "这不是一个网页。");
    const reader = response.body?.getReader();
    if (!reader) throw new SurfError("content", "页面没有内容。");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size > MAX_HTML_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? "utf-8";
    let html: string;
    try {
      html = new TextDecoder(charset).decode(Buffer.concat(chunks));
    } catch {
      html = new TextDecoder("utf-8").decode(Buffer.concat(chunks));
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
