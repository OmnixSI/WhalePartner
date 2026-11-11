import { createHash } from "node:crypto";
import { assertBilibiliRequestAllowed } from "../bilibili/video.ts";
import { loadBilibiliSession } from "../bilibili/session.ts";
import { BiliBackoff } from "./bili-backoff.ts";
import { classifyError, SurfError } from "./errors.ts";
import { acquireVideoLock, sharedParagraph, type VideoService } from "../video/service.ts";
import type { VideoCandidate, VideoSource, WatchedVideo } from "./types.ts";

/**
 * B 站这一侧（§10.6.8 A）。搜索走 WBI 签名的 `/x/web-interface/wbi/search/type`；
 * 看视频完全复用 `createVideoService().collect/summarize`，和用户分享视频是同一条管线。
 *
 * 本分支没有改 vendor/dsh-bilibili，所以搜索的签名和解析都写在这里，
 * 并且把解析单独拆成纯函数（`parseSearchPayload`），测试用录好的 JSON 夹具断言，不连外网。
 */

const SEARCH_ENDPOINT = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const NAV_ENDPOINT = "https://api.bilibili.com/x/web-interface/nav";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MIXIN_KEY_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** WBI 的 mixin key：按固定表重排 img_key+sub_key，取前 32 位。 */
export function mixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_TAB.map((index) => raw[index] ?? "").join("").slice(0, 32);
}

/** WBI 签名：参数按名排序、滤掉 `!'()*`、拼 query 后 md5。 */
export function signWbi(params: Record<string, string | number>, key: string, wts: number): Record<string, string> {
  const signed: Record<string, string> = {};
  for (const name of Object.keys(params).sort()) {
    signed[name] = String(params[name]).replace(/[!'()*]/g, "");
  }
  signed.wts = String(wts);
  const query = Object.keys(signed)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(signed[name])}`)
    .join("&");
  signed.w_rid = createHash("md5").update(query + key).digest("hex");
  return signed;
}

/** 搜索返回的时长是 "12:34"，也见过直接给秒数的；统一成秒。 */
export function durationSeconds(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
  if (typeof raw !== "string") return 0;
  const parts = raw.split(":").map((part) => Number(part.trim()));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const stripTags = (value: unknown) =>
  String(value ?? "")
    .replace(/<\/?em[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** 解析 `/x/web-interface/wbi/search/type` 的返回（§10.6.8 A.1）。非 0 code 直接抛错。 */
export function parseSearchPayload(payload: unknown): VideoCandidate[] {
  if (!payload || typeof payload !== "object") throw new Error("B 站搜索没有返回内容。");
  const body = payload as { code?: number; message?: string; data?: { result?: unknown } };
  if (body.code !== undefined && body.code !== 0) {
    const limited = [-352, -412, -799, -509].includes(body.code);
    throw new SurfError(limited ? "rate_limit" : "content", `B 站搜索失败：${body.message ?? body.code}`, { status: body.code });
  }
  const result = body.data?.result;
  const list = Array.isArray(result) ? result : Array.isArray((result as { list?: unknown } | undefined)?.list) ? ((result as { list: unknown[] }).list) : [];
  const out: VideoCandidate[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const bvid = String(item.bvid ?? "").trim();
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) continue;
    const pic = String(item.pic ?? "").trim();
    out.push({
      bvid,
      title: stripTags(item.title) || bvid,
      author: stripTags(item.author),
      durationSeconds: durationSeconds(item.duration),
      play: Number(item.play ?? 0) || 0,
      description: stripTags(item.description),
      pic: pic.startsWith("//") ? `https:${pic}` : pic,
      url: `https://www.bilibili.com/video/${bvid}`,
    });
  }
  return out;
}

export interface FetchJsonOptions {
  headers?: Record<string, string>;
}

export type JsonFetcher = (url: string, options?: FetchJsonOptions) => Promise<unknown>;

/** B 站接口请求之间至少隔 2 秒（和 vendor 里的请求队列同一个口径）。 */
const MIN_GAP_MS = 2000;
let lastRequestAt = 0;

const defaultFetchJson: JsonFetcher = async (url, options) => {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const response = await fetch(url, {
    headers: { "user-agent": UA, referer: "https://www.bilibili.com", ...(options?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 412 || response.status === 429 || response.status === 403) {
    throw new SurfError("rate_limit", `B 站返回了 ${response.status}，被限流了。`, { status: response.status });
  }
  if (!response.ok) throw new SurfError(response.status >= 500 ? "network" : "content", `B 站返回了 ${response.status}。`, { status: response.status });
  return (await response.json()) as unknown;
};

export interface BilibiliSourceDeps {
  /** 搜索用的 JSON 取数（测试里换成夹具，不连外网）。 */
  fetchJson?: JsonFetcher;
  /** 看视频用；不传就懒加载真实的 VideoService。 */
  video?: VideoService;
  /** 现在几点（签名要用 wts）。 */
  now?: () => number;
  /** 冲浪自己的指数退避（测试里换成临时文件）。 */
  backoff?: BiliBackoff;
}

async function wbiKeys(fetchJson: JsonFetcher): Promise<{ imgKey: string; subKey: string }> {
  const payload = (await fetchJson(NAV_ENDPOINT)) as { data?: { wbi_img?: { img_url?: string; sub_url?: string } } } | null;
  const imgUrl = payload?.data?.wbi_img?.img_url ?? "";
  const subUrl = payload?.data?.wbi_img?.sub_url ?? "";
  const name = (url: string) => url.split("/").pop()?.split(".")[0] ?? "";
  if (!imgUrl || !subUrl) throw new Error("B 站没有给出 WBI 签名用的密钥。");
  return { imgKey: name(imgUrl), subKey: name(subUrl) };
}

export function createBilibiliVideoSource(deps: BilibiliSourceDeps = {}): VideoSource {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  let videoService = deps.video;

  const backoff = deps.backoff ?? new BiliBackoff();
  // WBI 密钥半小时内不会变，别每次搜索都多打一个 nav 请求。
  let keys: { imgKey: string; subKey: string; at: number } | null = null;
  const currentKeys = async () => {
    if (keys && Date.now() - keys.at < 30 * 60_000) return keys;
    keys = { ...(await wbiKeys(fetchJson)), at: Date.now() };
    return keys;
  };

  return {
    async search(keyword) {
      // 两层冷却：视频摘要那边记下的限流（bilibili/video.ts），和冲浪自己的指数退避，任何一个在冷却都不发请求。
      await assertBilibiliRequestAllowed();
      await backoff.assertAllowed();
      try {
        const { imgKey, subKey } = await currentKeys();
        const params = signWbi(
          { search_type: "video", keyword, page: 1, order: "totalrank" },
          mixinKey(imgKey, subKey),
          now(),
        );
        const query = Object.keys(params)
          .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(params[name])}`)
          .join("&");
        const results = parseSearchPayload(await fetchJson(`${SEARCH_ENDPOINT}?${query}`));
        await backoff.recordSuccess();
        return results;
      } catch (error) {
        if (classifyError(error) === "rate_limit") await backoff.recordFailure(error instanceof Error ? error.message : String(error)).catch(() => undefined);
        throw error;
      }
    },

    async watch(candidate): Promise<WatchedVideo> {
      const release = acquireVideoLock();
      try {
        const service = videoService ?? (await import("../video/service.ts")).createVideoService();
        videoService = service;
        const collected = await service.collect(candidate.url);
        const summary = await service.summarize(collected);
        const text = sharedParagraph(summary.summary);
        if (!text.trim()) throw new Error("看完视频没读到内容。");
        await backoff.recordSuccess();
        return { bvid: candidate.bvid, title: summary.title || candidate.title, url: summary.url || candidate.url, text };
      } catch (error) {
        if (classifyError(error) === "rate_limit") await backoff.recordFailure(error instanceof Error ? error.message : String(error)).catch(() => undefined);
        throw error;
      } finally {
        release();
      }
    },
  };
}

/** 搜索时带上本机保存的 B 站登录态（有就带，没有也能搜）。 */
export async function bilibiliCookies(): Promise<Record<string, string>> {
  try {
    const session = await loadBilibiliSession();
    return session?.sessdata ? { cookie: `SESSDATA=${session.sessdata}` } : {};
  } catch {
    return {};
  }
}
