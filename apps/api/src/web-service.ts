import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export interface WebPage {
  url: string;
  title: string;
  text: string;
}

export interface WebService {
  read(url: string): Promise<WebPage>;
}

export class WebError extends Error {}

const MAX_BYTES = 1_500_000;
const MAX_TEXT = 8000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

/** 在聊天文字里找一个普通网页链接（B 站链接另走视频流程）。 */
export function extractWebTarget(text: string): string | undefined {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。！？）)]+/gi)) {
    try {
      const host = new URL(match[0]).hostname.toLowerCase();
      if (host === "b23.tv" || host === "bilibili.com" || host.endsWith(".bilibili.com")) continue;
      return match[0];
    } catch {
      /* 不是有效链接 */
    }
  }
  return undefined;
}

/** 内网、本机、链路本地、保留地址一律拒绝，避免被链接带去访问内部服务。 */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const lower = address.toLowerCase();
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower);
}

/** 连接时才校验解析出的地址（不是先查再连），这样 DNS 重绑定也绕不过去。 */
const safeLookup: typeof dnsLookup = ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
  const done = typeof options === "function" ? (options as typeof callback) : callback;
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) return done(error);
    const bad = addresses.find((entry) => isPrivateAddress(entry.address));
    if (bad || addresses.length === 0) return done(new WebError("这个链接指向内部地址，不会去读。"));
    const pick = addresses[0];
    const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    return wantsAll ? done(null, addresses) : done(null, pick.address, pick.family);
  });
}) as typeof dnsLookup;

function fetchOnce(url: URL): Promise<{ response: IncomingMessage; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { "user-agent": "WhalePartner/0.1 (+personal reader)", accept: "text/html,text/plain;q=0.9,*/*;q=0.1", "accept-language": "zh-CN,zh;q=0.9,en;q=0.5" } }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          request.destroy(new WebError("网页太大，没有读完。"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ response, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new WebError("网页打不开或太慢。")));
    request.on("error", (error) => reject(error instanceof WebError ? error : new WebError(`读不了这个网页：${error.message}`)));
    request.end();
  });
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|svg|template|nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const decode = (value: string) => value.replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => ENTITIES[entity] ?? " ").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
  const text = decode(body).replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
  return { title: decode(title).replace(/\s+/g, " ").trim(), text };
}

function decodeBody(body: Buffer, contentType: string): string {
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 2048).toString("latin1"))?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export function createWebService(): WebService {
  return {
    async read(input) {
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        throw new WebError("这不是有效的网页链接。");
      }
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebError("只能读 http 或 https 网页。");
        if (url.username || url.password) throw new WebError("链接里带了账号信息，不会去读。");
        const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
        if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || (isIP(host) === 0 && !host.includes("."))) {
          throw new WebError("这个链接指向内部地址，不会去读。");
        }
        if (isIP(host) && isPrivateAddress(host)) throw new WebError("这个链接指向内部地址，不会去读。");

        const { response, body } = await fetchOnce(url);
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          url = new URL(response.headers.location, url);
          continue;
        }
        if (status < 200 || status >= 300) throw new WebError(`网页返回了 ${status}。`);
        const type = String(response.headers["content-type"] ?? "");
        if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new WebError("这个链接不是网页文字，读不了。");
        const raw = decodeBody(body, type);
        const { title, text } = /text\/plain/i.test(type) ? { title: "", text: raw.trim() } : htmlToText(raw);
        if (text.length < 40) throw new WebError("网页里没有读到足够的文字。");
        return { url: url.toString(), title: title || url.hostname, text: text.slice(0, MAX_TEXT) };
      }
      throw new WebError("网页跳转太多次。");
    },
  };
}
