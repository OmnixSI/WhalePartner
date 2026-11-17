/** 「她自己去逛」的前端调用（规范 §10.6.9 / §10.6.10）。接口不在就返回 null，页面自己说“没逛成”。 */
import { API_BASE, authedUrl } from "./api";
import { describeNetError } from "./net";
import { timeOf } from "./surf-view";
import { m } from "../i18n";

export type SurfFrequency = "rare" | "normal" | "often";
export type SurfKind = "video" | "web";

export interface SurfSettings {
  character: string;
  enabled: boolean;
  frequency: SurfFrequency;
  interests: string[];
  blocked: string[];
  quiet: { start: string; end: string };
  video: boolean;
  web: boolean;
  shareToChat: boolean;
  /** 本机能不能读网页。 */
  webAvailable?: boolean;
  /** 渲染网页用的浏览器：第一次需要在后台下载一次，这里能看到进度。 */
  browser?: SurfBrowser | null;
}

export interface SurfBrowser {
  state: "idle" | "installing" | "ready" | "failed";
  percent: number | null;
  message: string;
}

export type SurfSettingsPatch = Partial<Omit<SurfSettings, "character" | "webAvailable" | "quiet">> & {
  quiet?: { start?: string; end?: string };
};

export interface SurfFeedItem {
  id: number;
  kind: SurfKind;
  title: string;
  url: string;
  sourceSite: string;
  thumb: string | null;
  thumbError: string | null;
  summary: string;
  comment: string;
  tags: string[];
  createdAt: string;
  sharedAt: string | null;
}

export interface SurfSource {
  site: string;
  count: number;
}

export interface SurfFeed {
  items: SurfFeedItem[];
  total: number;
  page: number;
  pageSize: number;
  /** 各来源带回过几条，给「来源」筛选用。 */
  sources?: SurfSource[];
}

export interface SurfStatus {
  running: boolean;
  sessionId: number | null;
  stage: "searching" | "watching" | "reading" | "writing" | null;
  todayCount: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  pausedReason: "quota" | "quiet" | "disabled" | null;
  webAvailable: boolean;
  browser?: SurfBrowser | null;
  /** 这一步在做什么，例如「在读《鲸歌是什么》」。 */
  detail?: string | null;
  /** 你正在聊天，她先等着。 */
  waiting?: boolean;
}

export interface SurfRunAnswer {
  ok: boolean;
  status: number;
  sessionId?: number | null;
  /** 服务端给的原因码：too_soon / already_running / quota / disabled */
  code?: string;
  message?: string;
}

export const FREQUENCY_LABEL: Record<SurfFrequency, string> = { rare: m.surf.lib.freqRare, normal: m.surf.lib.freqNormal, often: m.surf.lib.freqOften };
export const FREQUENCY_HINT: Record<SurfFrequency, string> = {
  rare: m.surf.lib.hintRare,
  normal: m.surf.lib.hintNormal,
  often: m.surf.lib.hintOften,
};

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getSurfSettings(character: string, signal?: AbortSignal): Promise<SurfSettings | null> {
  try {
    const response = await fetch(`${API_BASE}/api/surf/settings?character=${encodeURIComponent(character)}`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as SurfSettings;
  } catch {
    return null;
  }
}

/** 设置不合法的字段，服务端会回 400 invalid_settings，调用方把 message 摆到行下面。 */
export async function putSurfSettings(character: string, patch: SurfSettingsPatch): Promise<SurfSettings> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/surf/settings?character=${encodeURIComponent(character)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch (error) {
    // 0.2.3 桌面版在这里露出英文 `Load failed`：预检没放行 PUT。文案统一走 net.ts。
    throw new Error(describeNetError(error, m.surf.lib.settingsSaveWhat));
  }
  if (!response.ok) throw new Error(await readError(response, m.surf.lib.saveFailed(response.status)));
  return (await response.json()) as SurfSettings;
}

export async function getSurfStatus(character: string, signal?: AbortSignal): Promise<SurfStatus | null> {
  try {
    const response = await fetch(`${API_BASE}/api/surf/status?character=${encodeURIComponent(character)}`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as SurfStatus;
  } catch {
    return null;
  }
}

export async function getSurfFeed(
  query: { character: string; kind?: SurfKind; page?: number; pageSize?: number; q?: string; site?: string; from?: string; to?: string },
  signal?: AbortSignal,
): Promise<SurfFeed> {
  const params = new URLSearchParams({ character: query.character, page: String(query.page ?? 1), pageSize: String(query.pageSize ?? 20) });
  if (query.kind) params.set("kind", query.kind);
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.site) params.set("site", query.site);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const response = await fetch(`${API_BASE}/api/surf/feed?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(await readError(response, m.surf.lib.loadFailed(response.status)));
  return (await response.json()) as SurfFeed;
}

/** 让数据层直接拿到一条，详情里用。 */
export async function getSurfItem(id: number, signal?: AbortSignal): Promise<SurfFeedItem | null> {
  try {
    const response = await fetch(`${API_BASE}/api/surf/items/${id}`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as SurfFeedItem;
  } catch {
    return null;
  }
}

export async function runSurf(character: string): Promise<SurfRunAnswer> {
  try {
    const response = await fetch(`${API_BASE}/api/surf/run?character=${encodeURIComponent(character)}`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { sessionId?: number | null; error?: string; message?: string; reason?: string };
    return {
      ok: response.status === 202,
      status: response.status,
      sessionId: body.sessionId ?? null,
      code: body.error ?? body.reason,
      message: body.message,
    };
  } catch {
    return { ok: false, status: 0, code: "network", message: m.surf.lib.cannotReach };
  }
}

export async function deleteSurfItem(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/api/surf/items/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(m.surf.lib.forgetFailed(response.status));
}

export const thumbUrl = (id: number) => authedUrl(`${API_BASE}/api/surf/thumb/${id}`);

// ---- 本机看过到哪儿了（导航红点与「新」邮戳） ----

const SEEN_KEY = "wp.surf.seen";

export function readSeenId(): number {
  try {
    const raw = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return 0;
  }
}

export function markSeen(upTo: number) {
  try {
    if (upTo > readSeenId()) localStorage.setItem(SEEN_KEY, String(upTo));
  } catch {
    /* 隐私模式忽略 */
  }
}

export const isFresh = (item: SurfFeedItem, seenId: number) =>
  item.id > seenId && Date.now() - Date.parse(item.createdAt) < 24 * 60 * 60_000;

// ---- 小工具 ----

export function dayLabelOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return m.surf.lib.dayLabel(date.getMonth() + 1, date.getDate(), m.surf.lib.weekdays[date.getDay()]);
}

export function stampDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

/** 站点简称：bilibili → B站，其它取域名主体。 */
export function siteLabel(site: string): string {
  if (site === "bilibili") return m.surf.lib.bilibili;
  return site.replace(/^www\./, "");
}

export function nextRunText(status: SurfStatus | null): string {
  if (!status) return m.surf.lib.noSchedule;
  if (status.pausedReason === "disabled") return m.surf.lib.notExploring;
  if (!status.nextRunAt) return m.surf.lib.doneToday;
  return m.surf.lib.nextRun(timeOf(status.nextRunAt));
}

export { chatQuoteHref, dateRangeBounds, localDay, quoteText, timeOf, whenText, type DateRange } from "./surf-view";
