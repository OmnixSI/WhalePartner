import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isPrivateAddress } from "../web-service.ts";
import { lookup } from "node:dns/promises";
import type { SurfRepository } from "./store.ts";

/** 缩略图（§10.6.8 A.5 / B.5）：Node 侧直接下载，限 2 MB、只收 image/*，不引图像库。 */

const MAX_BYTES = 2 * 1024 * 1024;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface ThumbFetcher {
  /** 下载成功返回相对 surfDir 的路径（`thumbs/12.jpg`），失败返回 null。 */
  fetch(url: string, itemId: number, options?: { referer?: string; allowPrivate?: boolean }): Promise<string | null>;
}

export function extensionOf(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "jpg";
}

export function thumbFetcher(dir: string): ThumbFetcher {
  return {
    async fetch(url, itemId, options = {}) {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return null;
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") return null;
      try {
        if (!options.allowPrivate) {
          const addresses = await lookup(target.hostname, { all: true });
          if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) return null;
        }
        const headers: Record<string, string> = { "user-agent": UA, accept: "image/*" };
        if (options.referer) headers.referer = options.referer;
        const response = await fetch(target, { headers, signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return null;
        const type = response.headers.get("content-type") ?? "";
        if (!/^image\//i.test(type)) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0 || buffer.length > MAX_BYTES) return null;
        const name = `thumbs/${itemId}.${extensionOf(type)}`;
        await mkdir(join(dir, "thumbs"), { recursive: true });
        await writeFile(join(dir, name), buffer);
        return name;
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
