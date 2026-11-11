import { isPrivateAddress } from "../webpage/service.ts";
import { lookup } from "node:dns/promises";
import type { WebPageText, WebResult, WebSource } from "./types.ts";
import { withRetry } from "./errors.ts";
import { createPageReader, type PageReader } from "./page-reader.ts";

/**
 * 网上冲浪的搜索一侧（§10.6.8 B.1）：Bing 中文结果为主，被验证拦住时回退 DuckDuckGo。
 * 解析全是纯函数，测试用录好的 HTML 夹具断言；真实取数用 Node fetch（带公网地址校验）。
 * 读正文交给 browser.ts 的无头浏览器（静态 HTML 拿不到正文）。
 */

const BING = "https://cn.bing.com/search";
const DDG = "https://html.duckduckgo.com/html/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** base64url（补 padding，换回 +/）。 */
function fromBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const text = Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64").toString("utf8");
    return text || null;
  } catch {
    return null;
  }
}

/** Bing 的跳转链接（`/ck/a?...&u=a1<base64url>`）解回真实地址；解不出返回 null。 */
export function decodeBingRedirect(href: string): string | null {
  const raw = href.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  if (!/[?&]u=a1/i.test(raw)) return raw;
  const match = /[?&]u=a1([^&]+)/i.exec(raw);
  if (!match) return null;
  const decoded = fromBase64Url(match[1]);
  if (!decoded || !/^https?:\/\//i.test(decoded)) return null;
  return decoded;
}

/** DuckDuckGo 的结果链接（`//duckduckgo.com/l/?uddg=<urlencode>`）解回真实地址。 */
export function decodeDuckDuckGoRedirect(href: string): string | null {
  const raw = href.trim();
  if (!raw) return null;
  if (!/uddg=/.test(raw)) return /^https?:\/\//i.test(raw) ? raw : null;
  const match = /[?&]uddg=([^&]+)/i.exec(raw);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]);
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));

export const stripTags = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();

/** 解析 Bing 的 `li.b_algo` 列表。 */
export function parseBingResults(html: string): WebResult[] {
  const out: WebResult[] = [];
  const blocks = html.split(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>/i).slice(1);
  for (const block of blocks) {
    const anchor = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = decodeBingRedirect(decodeEntities(anchor[1]));
    if (!url) continue;
    const title = stripTags(anchor[2]);
    if (!title) continue;
    // 摘要既可能是 <div class="b_caption"><p>…</p></div>，也可能直接写在 <p class="b_lineclamp2"> 上。
    const nested = /<[^>]+class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const flat = /<p[^>]*class="[^"]*b_(?:caption|lineclamp)[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const snippet = stripTags(nested?.[1] ?? flat?.[1] ?? "").replace(/\s+/g, " ");
    out.push({ title, url, snippet });
    if (out.length >= 8) break;
  }
  return out;
}

/** 解析 DuckDuckGo 的 html 版结果。 */
export function parseDuckDuckGoResults(html: string): WebResult[] {
  const out: WebResult[] = [];
  const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const url = decodeDuckDuckGoRedirect(decodeEntities(match[1]));
    if (!url) continue;
    const title = stripTags(match[2]);
    if (!title) continue;
    out.push({ title, url, snippet: "" });
    if (out.length >= 8) break;
  }
  return out;
}

export type TextFetcher = (url: string) => Promise<string>;

const defaultFetchText: TextFetcher = async (url) => {
  const target = new URL(url);
  const addresses = await lookup(target.hostname, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("搜索地址解析到了内部网络，跳过。");
  }
  const response = await fetch(target, {
    headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.5", accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`搜索返回了 ${response.status}。`);
  return await response.text();
};

export interface WebSourceDeps {
  /** 搜索页取数（测试注入夹具）。 */
  fetchText?: TextFetcher;
  /** 正文阅读器（默认无头浏览器）。 */
  reader?: PageReader;
}

export interface SurfWebSource extends WebSource {
  read(url: string, options?: { signal?: AbortSignal }): Promise<WebPageText>;
}

export function createWebSource(deps: WebSourceDeps = {}): SurfWebSource {
  const fetchText = deps.fetchText ?? defaultFetchText;
  const reader = deps.reader ?? createPageReader();

  return {
    async search(keyword) {
      // 网络抖动原地退避重试一次；两个搜索源都失败才把错误抛给上层，只是没结果则返回空。
      let failure: unknown = null;
      const attempt = async (url: string, parse: (html: string) => WebResult[]) => {
        try {
          return parse(await withRetry(() => fetchText(url), { attempts: 2, baseMs: 600 }));
        } catch (error) {
          failure = error;
          return [];
        }
      };
      const bing = await attempt(`${BING}?q=${encodeURIComponent(keyword)}&setlang=zh-hans`, parseBingResults);
      if (bing.length > 0) return bing;
      const ddg = await attempt(`${DDG}?q=${encodeURIComponent(keyword)}`, parseDuckDuckGoResults);
      if (ddg.length === 0 && failure && bing.length === 0) throw failure;
      return ddg;
    },

    read(url, options) {
      return reader.read(url, options);
    },

    available() {
      return reader.available();
    },

    prepare() {
      reader.prepare();
    },

    browserStatus() {
      return reader.browserStatus();
    },
  };
}

/** 把搜索结果里的域名列表拿出来（给状态和日志用）。 */
export function hostsOf(results: readonly WebResult[]): string[] {
  const out: string[] = [];
  for (const result of results) {
    try {
      const host = new URL(result.url).hostname.toLowerCase().replace(/^www\./, "");
      if (host && !out.includes(host)) out.push(host);
    } catch {
      /* 忽略坏链接 */
    }
  }
  return out;
}
