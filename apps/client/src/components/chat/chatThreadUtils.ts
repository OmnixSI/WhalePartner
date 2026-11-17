import type { Turn } from "./types";
import { m } from "../../i18n/index.ts";

const WEEKDAYS = m.chat.backlog.weekdays;
const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return m.chat.dayLabel.today;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return m.chat.dayLabel.yesterday;
  return m.chat.dayLabel.date(date.getMonth() + 1, date.getDate(), WEEKDAYS[date.getDay()]);
}

export function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 列表里可见的轮次：去掉空话/失败的用户话，按 limit 取最近几条。 */
export function visibleTurns(turns: readonly Turn[], excludeKey?: string, limit = 3): Turn[] {
  return turns
    .filter((turn) => turn.key !== excludeKey && turn.text.trim() !== "" && !(turn.role === "me" && turn.status === "failed"))
    .slice(-limit);
}
