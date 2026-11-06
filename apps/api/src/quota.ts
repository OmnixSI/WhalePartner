import type { DatabaseSync } from "node:sqlite";

/** 每种动作花掉多少“贝壳”。聊天一次 1，看视频 20，读网页 3，写日记 5，冲浪按内容类型。 */
export const UNIT_COSTS = {
  chat: 1,
  video: 20,
  web: 3,
  journal: 5,
  surfVideo: 20,
  surfWeb: 3,
} as const;

export type UsageKind = "chat" | "video" | "web" | "journal" | "surf";
export const USAGE_KINDS: readonly UsageKind[] = ["chat", "video", "web", "journal", "surf"];

export interface QuotaConfig {
  quotaMonthlyUnits: number;
  quotaEnforce: boolean;
}

export interface QuotaPeriod {
  /** 本自然月第一天，`YYYY-MM-DD`（服务器本地时区）。 */
  start: string;
  /** 本自然月最后一天。 */
  end: string;
  /** 下次刷新的时刻，带本地时区偏移。 */
  resetsAt: string;
}

export interface QuotaSummary {
  billing: "off";
  enforced: boolean;
  period: QuotaPeriod;
  total: number;
  used: number;
  remaining: number;
  low: boolean;
  breakdown: Record<UsageKind, number>;
  costs: {
    chat: number;
    video: number;
    web: number;
    journal: number;
    surfVideo: number;
    surfWeb: number;
  };
  today: { used: number };
}

/** 额度用完时抛它；路由层转成 402 quota_exceeded。 */
export class QuotaExceededError extends Error {
  readonly code = "quota_exceeded";

  constructor() {
    super("这个月的贝壳用完了，下个月 1 号会重新给你。");
    this.name = "QuotaExceededError";
  }
}

export interface RecordOptions {
  character?: string;
  meta?: Record<string, unknown>;
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

function datePart(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function offsetPart(date: Date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/** 本地时区自然月的起止；统计和刷新都以这里为准。 */
export function localMonth(now: Date): { start: Date; end: Date; resets: Date } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    resets: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

/**
 * 额度是“用量透明表”：默认只记账不拦截（QUOTA_ENFORCE=0），
 * 打开拦截后额度不够时聊天/看视频会拿到 402。
 */
export class QuotaService {
  readonly #db: DatabaseSync;
  readonly #config: QuotaConfig;
  readonly #now: () => Date;

  constructor(db: DatabaseSync, config: QuotaConfig, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#config = config;
    this.#now = now;
  }

  record(kind: UsageKind, units: number, options: RecordOptions = {}) {
    this.#db
      .prepare("INSERT INTO usage_ledger (kind, units, character, meta_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(kind, units, options.character ?? null, options.meta ? JSON.stringify(options.meta) : null, this.#now().toISOString());
  }

  summary(): QuotaSummary {
    const now = this.#now();
    const { start, end, resets } = localMonth(now);
    const rows = this.#db
      .prepare("SELECT kind, COALESCE(SUM(units), 0) AS units FROM usage_ledger WHERE created_at >= ? AND created_at < ? GROUP BY kind")
      .all(start.toISOString(), resets.toISOString()) as unknown as Array<{ kind: string; units: number }>;
    const breakdown = Object.fromEntries(USAGE_KINDS.map((kind) => [kind, 0])) as Record<UsageKind, number>;
    for (const row of rows) {
      if ((USAGE_KINDS as readonly string[]).includes(row.kind)) breakdown[row.kind as UsageKind] = Number(row.units);
    }
    const used = USAGE_KINDS.reduce((sum, kind) => sum + breakdown[kind], 0);
    const total = this.#config.quotaMonthlyUnits;
    const remaining = Math.max(0, total - used);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayRow = this.#db
      .prepare("SELECT COALESCE(SUM(units), 0) AS units FROM usage_ledger WHERE created_at >= ? AND created_at < ?")
      .get(dayStart.toISOString(), dayEnd.toISOString()) as unknown as { units: number };
    return {
      billing: "off",
      enforced: this.#config.quotaEnforce,
      period: {
        start: datePart(start),
        end: datePart(end),
        resetsAt: `${datePart(resets)}T00:00:00${offsetPart(resets)}`,
      },
      total,
      used,
      remaining,
      low: total > 0 && remaining / total < 0.2,
      breakdown,
      costs: { ...UNIT_COSTS },
      today: { used: Number(todayRow.units) },
    };
  }

  /** 只有打开拦截且额度不够时才抛错。 */
  assertAvailable(units: number) {
    if (!this.#config.quotaEnforce) return;
    if (this.summary().remaining < units) throw new QuotaExceededError();
  }

  isLow(): boolean {
    return this.summary().low;
  }
}
