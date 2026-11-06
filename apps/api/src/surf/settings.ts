import type { SurfFrequency, SurfSettings, SurfSettingsPatch } from "./types.ts";

/** 设置不合法的统一错误（路由层转成 400 invalid_settings）。 */
export class SurfSettingsError extends Error {}

export const FREQUENCIES: SurfFrequency[] = ["rare", "normal", "often"];

export interface FrequencyPlan {
  /** 每日槽位（本地时间 HH:MM）。 */
  slots: string[];
  /** 每次会话最多看几个视频。 */
  videosPerSession: number;
  /** 每次会话最多翻几个网页。 */
  websPerSession: number;
  /** 当日视频/网页上限。 */
  videosPerDay: number;
  websPerDay: number;
}

/** §10.6.4 的频率表。 */
export const FREQUENCY_PLAN: Record<SurfFrequency, FrequencyPlan> = {
  rare: { slots: ["11:40", "19:20"], videosPerSession: 1, websPerSession: 3, videosPerDay: 2, websPerDay: 6 },
  normal: { slots: ["09:30", "13:30", "16:30", "19:20"], videosPerSession: 1, websPerSession: 3, videosPerDay: 4, websPerDay: 8 },
  often: {
    slots: ["08:30", "10:00", "11:30", "13:30", "15:00", "16:30", "18:00", "19:20"],
    videosPerSession: 2,
    websPerSession: 3,
    videosPerDay: 6,
    websPerDay: 12,
  },
};

export const MAX_INTERESTS = 8;
export const MAX_BLOCKED = 20;
export const MAX_TAG_CHARS = 12;

export function defaultSettings(character: string): SurfSettings {
  return {
    character,
    enabled: true,
    frequency: "normal",
    interests: [],
    blocked: [],
    quiet: { start: "23:00", end: "08:00" },
    video: true,
    web: true,
    shareToChat: true,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isClock(value: unknown): value is string {
  return typeof value === "string" && HHMM.test(value);
}

/** 本地时间是否落在静默时段内（跨午夜也支持）。 */
export function inQuietHours(quiet: { start: string; end: string }, now: Date): boolean {
  if (!isClock(quiet.start) || !isClock(quiet.end)) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const at = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = at(quiet.start);
  const end = at(quiet.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function tagList(value: unknown, max: number, field: string): string[] {
  if (!Array.isArray(value)) throw new SurfSettingsError(`${field} 必须是文字列表。`);
  if (value.length > max) throw new SurfSettingsError(`${field} 最多 ${max} 个。`);
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") throw new SurfSettingsError(`${field} 里只能放文字。`);
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if ([...trimmed].length > MAX_TAG_CHARS) throw new SurfSettingsError(`「${trimmed}」太长了，每个最多 ${MAX_TAG_CHARS} 个字。`);
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new SurfSettingsError(`${field} 只能是开或关。`);
  return value;
}

/** PUT /api/surf/settings 的校验（§10.6.10）。任何一项不合法都抛错，不做部分写入。 */
export function validateSettingsPatch(body: Record<string, unknown>): SurfSettingsPatch {
  const patch: SurfSettingsPatch = {};
  if (body.enabled !== undefined) patch.enabled = bool(body.enabled, "总开关");
  if (body.video !== undefined) patch.video = bool(body.video, "看视频");
  if (body.web !== undefined) patch.web = bool(body.web, "翻网页");
  if (body.shareToChat !== undefined) patch.shareToChat = bool(body.shareToChat, "讲给我听");
  if (body.frequency !== undefined) {
    if (!FREQUENCIES.includes(body.frequency as SurfFrequency)) throw new SurfSettingsError("频率只能是偶尔、常常或勤快。");
    patch.frequency = body.frequency as SurfFrequency;
  }
  if (body.interests !== undefined) patch.interests = tagList(body.interests, MAX_INTERESTS, "兴趣");
  if (body.blocked !== undefined) patch.blocked = tagList(body.blocked, MAX_BLOCKED, "不想看的");
  if (body.quiet !== undefined) {
    if (!body.quiet || typeof body.quiet !== "object" || Array.isArray(body.quiet)) throw new SurfSettingsError("安静时段要给开始和结束时间。");
    const quiet = body.quiet as Record<string, unknown>;
    const start = quiet.start;
    const end = quiet.end;
    if (start === undefined && end === undefined) throw new SurfSettingsError("安静时段要给开始和结束时间。");
    if (start !== undefined && !isClock(start)) throw new SurfSettingsError("安静时段的开始时间要写成 08:30 这样。");
    if (end !== undefined && !isClock(end)) throw new SurfSettingsError("安静时段的结束时间要写成 08:30 这样。");
    patch.quiet = { ...(start === undefined ? {} : { start: start as string }), ...(end === undefined ? {} : { end: end as string }) };
  }
  return patch;
}

/** 把一份旧设置和 patch 合起来，返回完整的新设置。 */
export function applySettingsPatch(current: SurfSettings, patch: SurfSettingsPatch): SurfSettings {
  return {
    ...current,
    ...patch,
    quiet: { ...current.quiet, ...(patch.quiet ?? {}) },
  };
}

/** 表行（snake_case）→ 设置对象。 */
export function settingsFromRow(row: Record<string, unknown>, character: string): SurfSettings {
  const parse = (value: unknown): string[] => {
    try {
      const parsed: unknown = JSON.parse(String(value ?? "[]"));
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    character,
    enabled: Number(row.enabled ?? 1) === 1,
    frequency: FREQUENCIES.includes(row.frequency as SurfFrequency) ? (row.frequency as SurfFrequency) : "normal",
    interests: parse(row.interests_json),
    blocked: parse(row.blocked_json),
    quiet: { start: String(row.quiet_start ?? "23:00"), end: String(row.quiet_end ?? "08:00") },
    video: Number(row.video ?? 1) === 1,
    web: Number(row.web ?? 1) === 1,
    shareToChat: Number(row.share_to_chat ?? 1) === 1,
  };
}
