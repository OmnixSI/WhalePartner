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

/** 明确只用来追踪/分享来源、不影响内容的查询参数。 */
const TRACKING_PARAMS = new Set([
  "spm", "scm", "fbclid", "gclid", "dclid", "msclkid", "yclid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src", "ref_url",
  "from", "share_source", "share_medium", "share_from", "share_plat", "share_session_id", "share_tag",
  "vd_source", "bbid", "buvid", "unique_k", "_hsenc", "_hsmi", "hmsr", "hmpl", "hmcu", "hmkw", "hmci", "isappinstalled",
  "from_source", "from_spmid", "from_login", "spm_id_from", "is_story_h5",
]);
const TRACKING_PREFIX = /^(utm_|spm_|share_|pk_|mkt_)/i;
const BV_IN_URL = /\/video\/(BV[0-9A-Za-z]{10})/;

/**
 * 规范化 URL，同一篇内容的不同写法要得到同一个字符串：
 * http/https 视为同一个、去 www./m. 前缀与默认端口、去 #片段与追踪参数（utm_*、spm、fbclid…）、
 * 查询参数排序、合并重复斜杠、去 index.html 与末尾斜杠。
 */
export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input.trim();
  }
  let host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (/^(m|mobile)\.[^.]+\.[^.]+/.test(host)) host = host.replace(/^(m|mobile)\./, "");
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PREFIX.test(key) && !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = params.length > 0 ? `?${params.map(([key, value]) => `${key}=${value}`).join("&")}` : "";
  const path = url.pathname
    .replace(/\/{2,}/g, "/")
    .replace(/\/index\.(?:html?|php|aspx?)$/i, "")
    .replace(/\/+$/, "");
  const port = url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : "";
  return `${host}${port}${path}${search}`;
}

/** 0.2.6 及以前的规范化（只去 utm_/#/末尾斜杠）。老数据的去重键是用它算的，所以保留着一起比对。 */
export function legacyNormalizeUrl(input: string): string {
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

const sha16 = (value: string) => createHash("sha1").update(value).digest("hex").slice(0, 16);

/** 去重键：B 站视频页统一成 `bv:BV…`（和搜索到的视频互认），其余是规范化 URL 的 sha1。 */
export function webDedupeKey(input: string): string {
  const bv = BV_IN_URL.exec(input)?.[1];
  if (bv && /(^|\.)bilibili\.com\//.test(input.replace(/^https?:\/\//, ""))) return BV_KEY(bv);
  return `web:${sha16(normalizeUrl(input))}`;
}

/** 新旧两种算法的键，查「是否看过」时都要比。 */
export function webDedupeKeys(input: string): string[] {
  const keys = [webDedupeKey(input)];
  const legacy = `web:${sha16(legacyNormalizeUrl(input))}`;
  if (!keys.includes(legacy)) keys.push(legacy);
  return keys;
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
  /** 最近几次会话用过的话题，新的在前。用来避免同一主题连着出现。 */
  history?: ReadonlyArray<readonly string[]>;
  /** 注入随机源，方便测试。返回 [0,1)。 */
  random?: () => number;
}

const clean = (list: readonly string[]) => list.map((item) => item.trim()).filter(Boolean);

const topicGrams = (topic: string) => {
  const chars = [...topic.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")];
  if (chars.length <= 1) return new Set(chars);
  const grams = new Set<string>();
  for (let i = 0; i < chars.length - 1; i += 1) grams.add(chars[i] + chars[i + 1]);
  return grams;
};

/** 两个话题是不是「同一个主题」：互相包含，或二字组重合度高。 */
export function topicsSimilar(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const gx = topicGrams(x);
  const gy = topicGrams(y);
  if (gx.size === 0 || gy.size === 0) return false;
  let shared = 0;
  for (const gram of gx) if (gy.has(gram)) shared += 1;
  return shared / Math.min(gx.size, gy.size) >= 0.5;
}

/** 最近出现过越近，权重越低：上一次 0.08，上上次 0.3，再往前慢慢恢复。 */
const RECENCY_WEIGHT = [0.08, 0.3, 0.55, 0.78, 0.92];

function freshness(topic: string, history: ReadonlyArray<readonly string[]>): number {
  for (let index = 0; index < Math.min(history.length, RECENCY_WEIGHT.length); index += 1) {
    if (history[index].some((used) => topicsSimilar(topic, used))) return RECENCY_WEIGHT[index];
  }
  return 1;
}

interface Weighted {
  topic: string;
  weight: number;
}

/** 按权重不放回抽样；已选过的和相似的会被排除。 */
function sampleWeighted(pool: Weighted[], count: number, random: () => number, chosen: string[]): string[] {
  const out: string[] = [];
  const rest = pool.filter((entry) => entry.weight > 0);
  while (out.length < count && rest.length > 0) {
    const total = rest.reduce((sum, entry) => sum + entry.weight, 0);
    let ticket = random() * total;
    let index = rest.findIndex((entry) => (ticket -= entry.weight) < 0);
    if (index === -1) index = rest.length - 1;
    const [picked] = rest.splice(index, 1);
    if ([...chosen, ...out].some((topic) => topicsSimilar(topic, picked.topic))) continue;
    out.push(picked.topic);
  }
  return out;
}

/**
 * 选题（§10.6.3-4），在原规则上加了多样性：
 * 人格兴趣 2 个 + 用户补充 1–2 个 + 近期聊天话题 1–2 个，按权重抽样，
 * 最近几次会话用过的主题（含近义）权重压低，同一批里也不放两个相近的；
 * 去掉命中屏蔽词的，保证至少 1 个；全空时回退到人格兴趣的随机 2 个。
 */
export function pickTopics(input: TopicInput): string[] {
  const random = input.random ?? Math.random;
  const history = input.history ?? [];
  const blocked = input.blocked;
  const allowed = (list: readonly string[]) => [...new Set(clean(list).filter((topic) => !containsBlocked(topic, blocked)))];
  const weigh = (list: string[], base: number): Weighted[] =>
    list.map((topic) => ({ topic, weight: base * freshness(topic, history) * (0.75 + random() * 0.5) }));

  const persona = weigh(allowed(input.personaInterests), 1);
  const user = weigh(allowed(input.userInterests), 1.3);
  const recent = weigh(allowed(input.recentTopics), 1.6);

  const topics: string[] = [];
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  topics.push(...sampleWeighted(recent, between(1, 2), random, topics));
  topics.push(...sampleWeighted(user, between(1, 2), random, topics));
  topics.push(...sampleWeighted(persona, 2, random, topics));
  // 新鲜度高的排前面：视频只看前两个话题，别让刚逛过的主题占着头两位。
  const ordered = topics
    .map((topic) => ({ topic, rank: freshness(topic, history) + random() * 0.2 }))
    .sort((x, y) => y.rank - x.rank)
    .map((entry) => entry.topic);

  const capped = ordered.slice(0, 5);
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
    const keys = webDedupeKeys(result.url);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
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


// ---- 先打分，再决定读哪几页 ----

const CLICKBAIT = /(震惊|必看|速看|赶紧|不转不是|99%的人|点击(领取|查看|进入)|立即(领取|下载|注册)|限时|优惠|折扣|招聘|招商|加盟|免费领|代理|下载安装|官网首页|登录|注册)/;
const GOOD_HOSTS = ["wikipedia.org", "sspai.com", "juejin.cn", "guokr.com", "nationalgeographic.com", "natgeo.com.cn", "huxiu.com", "ifanr.com", "geekpark.net", "medium.com", "wikimedia.org", "gov.cn", "nature.com", "bbc.com", "thepaper.cn"];
const WEAK_HOSTS = ["baijiahao.baidu.com", "sohu.com", "163.com/dy", "toutiao.com", "so.com", "sogou.com", "csdn.net", "51cto.com", "360doc.com", "docin.com", "wenku.baidu.com", "baike.baidu.com/item"];
const NON_HTML = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|exe|dmg|apk|mp3|mp4|jpg|png)(\?|$)/i;

/** 话题拆成可比对的词：整词 + 中文二字组。 */
export function topicTokens(topics: readonly string[]): string[] {
  const tokens = new Set<string>();
  for (const topic of topics) {
    const whole = topic.trim().toLowerCase();
    if (whole) tokens.add(whole);
    for (const gram of topicGrams(whole)) if (gram.length >= 2) tokens.add(gram);
  }
  return [...tokens];
}

function overlap(text: string, tokens: readonly string[]): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const token of tokens) if (lower.includes(token)) hits += token.length >= 3 ? 1.5 : 1;
  return Math.min(hits, 6);
}

export interface ScoreContext {
  topics: readonly string[];
  /** 最近看过的标题，撞了就扣分。 */
  recentTitles?: readonly string[];
}

/** 网页搜索结果按标题和摘要打分（越高越值得读）。 */
export function scoreWebResult(result: WebResult, context: ScoreContext, position = 0): number {
  const tokens = topicTokens(context.topics);
  let score = overlap(result.title, tokens) * 1.5 + overlap(result.snippet, tokens);
  if (result.snippet.length >= 40) score += 1;
  else if (result.snippet.length === 0) score -= 1;
  const titleLength = [...result.title].length;
  if (titleLength >= 6 && titleLength <= 40) score += 0.5;
  if (CLICKBAIT.test(`${result.title} ${result.snippet}`)) score -= 3;
  if (NON_HTML.test(result.url)) score -= 3;
  const lowerUrl = result.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
  if (GOOD_HOSTS.some((host) => lowerUrl.startsWith(host) || lowerUrl.includes(`.${host}`))) score += 1;
  if (WEAK_HOSTS.some((host) => lowerUrl.includes(host))) score -= 1.5;
  if ((context.recentTitles ?? []).some((title) => topicsSimilar(result.title, title))) score -= 2;
  score += Math.max(0, 8 - position) * 0.15;
  return Math.round(score * 100) / 100;
}

/** 打分、剔除明显的垃圾（负分）、按分数从高到低取前 `limit` 个。 */
export function rankWebResults(results: readonly WebResult[], context: ScoreContext, limit = 6): WebResult[] {
  return results
    .map((result, position) => ({ result, score: scoreWebResult(result, context, position), position }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit)
    .map((entry) => entry.result);
}

/** 视频候选打分：话题贴合度、播放量、时长合适、不是标题党。 */
export function scoreVideo(candidate: VideoCandidate, context: ScoreContext): number {
  const tokens = topicTokens(context.topics);
  let score = overlap(candidate.title, tokens) * 1.5 + overlap(candidate.description, tokens) * 0.5;
  score += Math.min(3, Math.max(0, Math.log10(Math.max(1, candidate.play)) - 3));
  const minutes = candidate.durationSeconds / 60;
  if (minutes >= 3 && minutes <= 15) score += 1;
  else if (minutes < 2) score -= 0.5;
  if (CLICKBAIT.test(`${candidate.title} ${candidate.description}`)) score -= 3;
  if ((context.recentTitles ?? []).some((title) => topicsSimilar(candidate.title, title))) score -= 2;
  return Math.round(score * 100) / 100;
}

export function rankVideos(candidates: readonly VideoCandidate[], context: ScoreContext, limit = MAX_CANDIDATES): VideoCandidate[] {
  return candidates
    .map((candidate, position) => ({ candidate, score: scoreVideo(candidate, context), position }))
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
