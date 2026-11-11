import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isPrivateHostname, safeLookup } from "../webpage/service.ts";
import type { SurfRepository } from "./store.ts";

/** 缩略图（§10.6.8 A.5 / B.5）：Node 侧直接下载，限 2 MB、只收 image/*，不引图像库。 */

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface ThumbFetcher {
  /** 下载成功返回相对 surfDir 的路径（`thumbs/12.jpg`），失败返回 null。 */
  fetch(url: string, itemId: number, options?: { referer?: string; allowPrivate?: boolean }): Promise<string | null>;
}

interface ThumbHop {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  tooLarge: boolean;
}

/** 连接时才校验解析出的地址；响应流式读取，超过 2 MB 立刻断开，不把整个「图片」读进内存。 */
function requestThumb(target: URL, options: { signal: AbortSignal; lookup?: typeof dnsLookup; headers: Record<string, string> }): Promise<ThumbHop> {
  return new Promise((resolve, reject) => {
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(target, {
      ...(options.lookup ? { lookup: options.lookup } : {}),
      signal: options.signal,
      headers: options.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let tooLarge = false;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks), tooLarge });
      };
      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_BYTES) {
          tooLarge = true;
          finish();
          response.destroy();
          return;
        }
        chunks.push(chunk);
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

export function extensionOf(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

export function thumbFetcher(dir: string, options: { lookup?: typeof dnsLookup } = {}): ThumbFetcher {
  return {
    async fetch(url, itemId, fetchOptions = {}) {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return null;
      }
      const headers: Record<string, string> = { "user-agent": UA, accept: "image/*" };
      if (fetchOptions.referer) headers.referer = fetchOptions.referer;
      try {
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
          if (target.protocol !== "http:" && target.protocol !== "https:") return null;
          if (!fetchOptions.allowPrivate && isPrivateHostname(target.hostname)) return null;
          const response = await requestThumb(target, {
            signal: AbortSignal.timeout(15_000),
            lookup: fetchOptions.allowPrivate ? undefined : (options.lookup ?? safeLookup),
            headers,
          });
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.location;
            if (!location) return null;
            target = new URL(location, target);
            continue;
          }
          if (response.status < 200 || response.status >= 300 || response.tooLarge) return null;
          const type = String(response.headers["content-type"] ?? "");
          if (!/^image\//i.test(type)) return null;
          if (response.body.length === 0 || response.body.length > MAX_BYTES) return null;
          const name = `thumbs/${itemId}.${extensionOf(type)}`;
          await mkdir(join(dir, "thumbs"), { recursive: true });
          await writeFile(join(dir, name), response.body);
          return name;
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}

export async function repairMissingThumbnails(
  store: SurfRepository,
  fetcher: ThumbFetcher,
  dir: string,
  coverUrlForBvid = bilibiliCoverUrl,
) {
  for (const item of store.thumbnails()) {
    if (item.thumbPath && existsSync(join(dir, item.thumbPath))) continue;
    let source = item.thumbSourceUrl;
    if (!source && item.kind === "video") {
      const bvid = /^bv:(BV[0-9A-Za-z]{10})$/u.exec(item.dedupeKey)?.[1]
        ?? /\/video\/(BV[0-9A-Za-z]{10})/u.exec(item.url)?.[1];
      if (bvid) source = await coverUrlForBvid(bvid).catch(() => null);
      if (source) store.setThumbSource(item.id, source);
    }
    if (!source) {
      store.setThumbError(item.id, "封面地址缺失");
      continue;
    }
    const path = await fetcher.fetch(source, item.id, {
      referer: item.sourceSite === "bilibili" ? "https://www.bilibili.com" : undefined,
    }).catch(() => null);
    if (path) store.setThumb(item.id, path);
    else store.setThumbError(item.id, "封面下载失败");
  }
}

async function bilibiliCoverUrl(bvid: string): Promise<string | null> {
  const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
    headers: { "user-agent": UA, referer: "https://www.bilibili.com" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { code?: number; data?: { pic?: string } };
  if (payload.code !== 0 || typeof payload.data?.pic !== "string") return null;
  return payload.data.pic.startsWith("//") ? `https:${payload.data.pic}` : payload.data.pic;
}

/** 缩略图接口用的 MIME：按扩展名反推。 */
export function mimeOfFile(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}
