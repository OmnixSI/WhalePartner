import type { DiaryItem } from "../../lib/diary";

/**
 * 日记页用到的形状（规范 §7.2 / §10.5）。
 *
 * `mood` / `weather` / `diaryTitle` 由后端 B3 回填；当前这条分支的 `/api/diary` 还没有这三个字段，
 * 所以它们全部可选：取不到就整块不画（不报错、不留白框），绝不拿别的字段冒充。
 */
export type DiaryItemP2 = DiaryItem & {
  mood?: string | null;
  weather?: string | null;
  diaryTitle?: string | null;
};

export type DoodleName = "sun" | "cloud" | "rain" | "moon" | "wave" | "star";

/** 天气 → 涂鸦（规范 §7.2.4 的映射表，一个不多一个不少）。 */
export const WEATHER: Record<string, { doodle: DoodleName; label: string }> = {
  sunny: { doodle: "sun", label: "晴" },
  cloudy: { doodle: "cloud", label: "多云" },
  rain: { doodle: "rain", label: "雨" },
  night: { doodle: "moon", label: "夜" },
  wind: { doodle: "wave", label: "风" },
  snow: { doodle: "star", label: "雪" },
};

/** 心情的中文（规范 §7.2.4）。 */
export const MOOD: Record<string, string> = {
  happy: "开心",
  calm: "平静",
  tired: "有点累",
  excited: "兴奋",
  sad: "有点难过",
  cozy: "暖洋洋",
  curious: "好奇",
};

export const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;
export const MONTH_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** 日记的日期：写完的时间优先，其次入队时间。 */
export function diaryAt(item: DiaryItemP2): Date | null {
  const raw = item.processedAt ?? item.createdAt;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 有正文才算“一页日记”。 */
export function hasText(item: DiaryItemP2): boolean {
  return Boolean(item.diaryText && item.diaryText.trim());
}

export function weatherOf(item: DiaryItemP2): { doodle: DoodleName; label: string } | null {
  const key = item.weather;
  if (!key) return null;
  return WEATHER[key] ?? null;
}

export function moodOf(item: DiaryItemP2): string | null {
  const key = item.mood;
  if (!key) return null;
  return MOOD[key] ?? null;
}

/** 小标题：她的标题 → 视频标题 → 日期。三级都没有就给日期，永远不空。 */
export function titleOf(item: DiaryItemP2, at: Date | null, fallback: string): string {
  const own = item.diaryTitle?.trim();
  if (own) return own;
  const video = item.title?.trim();
  if (video) return video;
  if (at) return `${at.getMonth() + 1}月${at.getDate()}日`;
  return fallback;
}

export function isoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 周一为一周之始。 */
export function startOfWeek(date: Date): Date {
  const base = startOfDay(date);
  const shift = (base.getDay() + 6) % 7;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() - shift);
}

export function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
}

export type RangeMode = "week" | "month" | "year";

export function rangeOf(mode: RangeMode, cursor: Date): { start: Date; end: Date } {
  if (mode === "week") return { start: startOfWeek(cursor), end: endOfWeek(cursor) };
  if (mode === "month") {
    return {
      start: new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
    };
  }
  return { start: new Date(cursor.getFullYear(), 0, 1), end: new Date(cursor.getFullYear(), 11, 31) };
}
