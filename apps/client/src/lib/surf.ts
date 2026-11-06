/** 「她自己去逛」的前端调用（规范 §10.6.9 / §10.6.10）。接口不在就返回 null，页面自己说“没逛成”。 */
import { API_BASE } from "./api";

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
  /** 本机能不能读网页（没装 Chromium 时 false）。 */
  webAvailable?: boolean;
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
  summary: string;
  comment: string;
  tags: string[];
  createdAt: string;
  sharedAt: string | null;
}

export interface SurfFeed {
  items: SurfFeedItem[];
  total: number;
  page: number;
  pageSize: number;
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
}

export interface SurfRunAnswer {
  ok: boolean;
  status: number;
  sessionId?: number | null;
  /** 服务端给的原因码：too_soon / already_running / quota / disabled */
  code?: string;
  message?: string;
}

export const FREQUENCY_LABEL: Record<SurfFrequency, string> = { rare: "偶尔", normal: "常常", often: "勤快" };
export const FREQUENCY_HINT: Record<SurfFrequency, string> = {
  rare: "一天 2 次",
  normal: "一天 4 次",
  often: "一天 8 次",
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
  const response = await fetch(`${API_BASE}/api/surf/settings?character=${encodeURIComponent(character)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(await readError(response, `存不上（HTTP ${response.status}）`));
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
  query: { character: string; kind?: SurfKind; page?: number; pageSize?: number; q?: string },
  signal?: AbortSignal,
): Promise<SurfFeed> {
  const params = new URLSearchParams({ character: query.character, page: String(query.page ?? 1), pageSize: String(query.pageSize ?? 20) });
  if (query.kind) params.set("kind", query.kind);
  if (query.q?.trim()) params.set("q", query.q.trim());
  const response = await fetch(`${API_BASE}/api/surf/feed?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(await readError(response, `见闻翻不开（HTTP ${response.status}）`));
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
    return { ok: false, status: 0, code: "network", message: "现在连不上她。" };
  }
}

export async function deleteSurfItem(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/api/surf/items/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`忘不掉（HTTP ${response.status}）`);
}

export const thumbUrl = (id: number) => `${API_BASE}/api/surf/thumb/${id}`;

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
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${week}`;
}

export function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function stampDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

/** 站点简称：bilibili → B站，其它取域名主体。 */
export function siteLabel(site: string): string {
  if (site === "bilibili") return "B站";
  return site.replace(/^www\./, "");
}

/** 打开原链接：Tauri 里走系统浏览器，浏览器里开新标签。 */
export function openOriginal(url: string) {
  if (!url) return;
  window.open(url, "_blank", "noopener");
}

export function nextRunText(status: SurfStatus | null): string {
  if (!status) return "现在还看不到她的安排";
  if (status.pausedReason === "disabled") return "她现在不去逛了";
  if (!status.nextRunAt) return "她今天逛完了";
  return `下一次 ${timeOf(status.nextRunAt)}`;
}
