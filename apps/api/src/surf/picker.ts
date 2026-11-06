import { createHash } from "node:crypto";
import { containsBlocked, isBlockedHost } from "./blocklist.ts";
import type { VideoCandidate, WebResult } from "./types.ts";

/** 视频候选的筛选边界（§10.6.8 A.2）。 */
export const MIN_VIDEO_SECONDS = 60;
export const MAX_VIDEO_SECONDS = 20 * 60;
export const MIN_VIDEO_PLAY = 5000;
export const MAX_CANDIDATES = 8;
/** 同一个域名每天最多访问 2 次（§10.6.8 B.2）。 */
export const MAX_PER_HOST_PER_DAY = 2;
/** 网页搜索的关键词后缀，让搜索结果更像读物。 */
const WEB_SUFFIXES = ["是什么", "最新", "有趣的事", "入门"];

export const BV_KEY = (bvid: string) => `bv:${bvid}`;

/** 规范化 URL：去掉 utm_* 参数、#片段、末尾的 /；再取 sha1 前 16 位（§10.6.8 B.2）。 */
export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input.trim();
  }
  const params = [...url.searchParams.entries()].filter(([key]) => !/^utm_/i.test(key));
  const search = params.length > 0 ? `?${params.map(([key, value]) => `${key}=${value}`).join("&")}` : "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host.toLowerCase()}${path}${search}`;
}

export function webDedupeKey(input: string): string {
  return `web:${createHash("sha1").update(normalizeUrl(input)).digest("hex").slice(0, 16)}`;
}

export function siteOf(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export interface TopicInput {
  /** 人格自带的兴趣。 */
  personaInterests: readonly string[];
  /** 用户在设置里补的。 */
  userInterests: readonly string[];
  /** 从近期聊天里提炼的话题。 */
  recentTopics: readonly string[];
  /** 屏蔽词（用户 + 内置，已经合并过）。 */
  blocked: readonly string[];
  /** 注入随机源，方便测试。返回 [0,1)。 */
  random?: () => number;
}

const clean = (list: readonly string[]) => list.map((item) => item.trim()).filter(Boolean);

/**
 * 选题（§10.6.3-4）：随机 2 个人格兴趣 + 1–2 个用户补充 + 1–2 个近期话题，
 * 去掉命中屏蔽词的，保证至少 1 个；全空时回退到人格兴趣的随机 2 个。
 */
export function pickTopics(input: TopicInput): string[] {
  const random = input.random ?? Math.random;
  const blocked = input.blocked;
  const allowed = (list: readonly string[]) => clean(list).filter((topic) => !containsBlocked(topic, blocked));
  const persona = allowed(input.personaInterests);
  const user = allowed(input.userInterests);
  const recent = allowed(input.recentTopics);

  const take = (list: string[], min: number, max: number) => {
    const wanted = min + Math.floor(random() * (max - min + 1));
    const pool = shuffle(list, random);
    return pool.slice(0, Math.max(0, wanted));
  };

  const topics: string[] = [];
  const push = (topic: string) => {
    if (topic && !topics.includes(topic)) topics.push(topic);
  };
  take(persona, 2, 2).forEach(push);
  take(user, 1, 2).forEach(push);
  take(recent, 1, 2).forEach(push);

  const capped = topics.slice(0, 5);
  if (capped.length > 0) return capped;
  // 全被屏蔽词吃掉时，退回人格兴趣里随便两个（不再过屏蔽词，否则永远为空）。
  const fallback = shuffle(clean(input.personaInterests), random).slice(0, 2);
  return fallback.length > 0 ? fallback : ["海洋"];
}

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 网页搜索词 = 话题 + 一个随机后缀（§10.6.3-5）。 */
export function webQueryFor(topic: string, random: () => number = Math.random): string {
  const suffix = WEB_SUFFIXES[Math.floor(random() * WEB_SUFFIXES.length)] ?? WEB_SUFFIXES[0];
  return `${topic} ${suffix}`;
}

export interface CandidateFilterInput {
  blocked: readonly string[];
  /** 已经逛过的去重键。 */
  seen: readonly string[];
  /** 已看过的 BV 号（含用户分享过的 bili: 前缀经验）。 */
  seenBvids?: readonly string[];
}

/** 视频候选筛选（§10.6.8 A.2）：时长、播放量、屏蔽词、去重，保留前 8。 */
export function filterCandidates(candidates: readonly VideoCandidate[], input: CandidateFilterInput): VideoCandidate[] {
  const seen = new Set(input.seen);
  const seenBvids = new Set(input.seenBvids ?? []);
  const out: VideoCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.bvid) continue;
    if (candidate.durationSeconds < MIN_VIDEO_SECONDS || candidate.durationSeconds > MAX_VIDEO_SECONDS) continue;
    if (candidate.play < MIN_VIDEO_PLAY) continue;
    const haystack = `${candidate.title} ${candidate.author} ${candidate.description}`;
    if (containsBlocked(haystack, input.blocked)) continue;
    if (seenBvids.has(candidate.bvid)) continue;
    if (seen.has(BV_KEY(candidate.bvid))) continue;
    out.push(candidate);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

export interface WebFilterInput {
  blocked: readonly string[];
  seen: readonly string[];
  /** 今天各域名已访问次数。 */
  hostCounts?: Readonly<Record<string, number>>;
  /** 判断解析出来的地址是不是公网（注入，测试不用 DNS）。 */
  isPublic?: (host: string) => boolean;
}

/** 网页候选筛选（§10.6.8 B.2）：登录墙、屏蔽词/域名、去重、同域名每日次数、非 http(s)/私网。 */
export function filterWebResults(results: readonly WebResult[], input: WebFilterInput): WebResult[] {
  const seen = new Set(input.seen);
  const counts = input.hostCounts ?? {};
  const isPublic = input.isPublic ?? (() => true);
  const out: WebResult[] = [];
  const perHost = new Map<string, number>();
  for (const result of results) {
    let url: URL;
    try {
      url = new URL(result.url);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || isBlockedHost(host)) continue;
    if (!isPublic(host)) continue;
    if (containsBlocked(`${result.title} ${result.snippet}`, input.blocked)) continue;
    const key = webDedupeKey(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const used = (counts[host] ?? 0) + (perHost.get(host) ?? 0);
    if (used >= MAX_PER_HOST_PER_DAY) continue;
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    out.push(result);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** 从模型回复里抠出 JSON（容忍 ```json 围栏和前后废话）。 */
export function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 模型挑视频：`{"index": n}`；解析失败取第一个（§10.6.8 A.3）。 */
export function parseVideoPick(raw: string, length: number): number {
  const parsed = extractJson(raw);
  const index = parsed && typeof parsed === "object" ? Number((parsed as { index?: unknown }).index) : Number.NaN;
  if (Number.isInteger(index) && index >= 0 && index < length) return index;
  return 0;
}

/** 模型挑网页：`{"picks":[{"index":0}]}`，去重、限 ≤3（§10.6.8 B.2）。 */
export function parseWebPicks(raw: string, length: number): number[] {
  const parsed = extractJson(raw);
  const picks = parsed && typeof parsed === "object" ? (parsed as { picks?: unknown }).picks : undefined;
  const out: number[] = [];
  if (Array.isArray(picks)) {
    for (const item of picks) {
      const index = Number((item as { index?: unknown } | null)?.index);
      if (Number.isInteger(index) && index >= 0 && index < length && !out.includes(index)) out.push(index);
      if (out.length >= 3) break;
    }
  }
  if (out.length === 0 && length > 0) out.push(0);
  return out;
}
