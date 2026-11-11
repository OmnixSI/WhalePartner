import type { DatabaseSync } from "node:sqlite";

/** 本地日期键（YYYY-MM-DD）：限额判断和按天记账用同一种“当天”。 */
export function localDayKey(now: Date): string {
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${local.getFullYear()}-${month}-${day}`;
}

/** 本地零点，用来把按天统计和数据库里的 UTC 时间对齐。 */
export function localDayStart(now: Date): Date {
  const local = new Date(now);
  local.setHours(0, 0, 0, 0);
  return local;
}

/**
 * 按天记账。表里没有指向聊天记录的外键：删会话、清历史都不会把当天的计数抹掉，
 * 好感度上限和主动消息次数因此不会在删除后重新计数。
 */
export class DailyCounters {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  value(name: string, subject = "", now = new Date()): number {
    const row = this.#db.prepare("SELECT value FROM daily_counters WHERE day = ? AND name = ? AND subject = ?")
      .get(localDayKey(now), name, subject) as { value: number } | undefined;
    return Number(row?.value ?? 0);
  }

  /** 最近一次记账时间（跨天也算），主动消息的冷却用它。 */
  lastAt(name: string, subject = ""): Date | null {
    const row = this.#db.prepare("SELECT updated_at AS updatedAt FROM daily_counters WHERE name = ? AND subject = ? ORDER BY updated_at DESC LIMIT 1")
      .get(name, subject) as { updatedAt: string } | undefined;
    const at = row ? Date.parse(row.updatedAt) : Number.NaN;
    return Number.isFinite(at) ? new Date(at) : null;
  }

  add(name: string, subject = "", amount = 1, now = new Date()): void {
    this.#db.prepare(`
      INSERT INTO daily_counters(day, name, subject, value, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, name, subject) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at
    `).run(localDayKey(now), name, subject, amount, now.toISOString());
  }
}
