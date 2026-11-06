import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http.ts";
import type { ServerDeps } from "../server-types.ts";

/**
 * 额度（用量透明表，规范 §10.5 B1）——从 P-B 分支移植到 main 的新路由结构。
 *
 * 只做「只读 + 记账准备」：GET /api/quota 返回本月用量；没有 usage_ledger 表时按 0 计。
 * 开启拦截（QUOTA_ENFORCE=1）时，聊天链路在开流前读 quotaUsage() 并返回 402；这里保证界面拿得到真实数字。
 */
const MONTHLY_UNITS = Number(process.env.QUOTA_MONTHLY_UNITS ?? 3000);

function monthStart(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-01T00:00:00.000Z`;
}

/** 供聊天链路判断要不要拦：返回本月已用与总量；表不存在按 0。 */
export function quotaUsage(dbPath: string): { used: number; total: number; enforced: boolean } {
  let db: DatabaseSync | undefined;
  try {
    db = openLedger(dbPath);
    const row = db.prepare("SELECT COALESCE(SUM(units), 0) AS used FROM usage_ledger WHERE at >= ?").get(monthStart()) as { used?: number } | undefined;
    return { used: Number(row?.used ?? 0), total: MONTHLY_UNITS, enforced: process.env.QUOTA_ENFORCE === "1" };
  } catch {
    return { used: 0, total: MONTHLY_UNITS, enforced: process.env.QUOTA_ENFORCE === "1" };
  } finally {
    db?.close();
  }
}

function openLedger(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character TEXT NOT NULL,
      kind TEXT NOT NULL,
      units INTEGER NOT NULL,
      at TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS usage_ledger_at ON usage_ledger(at)");
  return db;
}

/** `/api/quota`：本月已用 / 总量 / 剩余 / 分类明细。 */
export async function handleQuotaRoute(
  deps: ServerDeps,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/quota") return false;
  let db: DatabaseSync | undefined;
  try {
    db = openLedger(deps.config.dbPath);
    const since = monthStart();
    const rows = db
      .prepare("SELECT kind, SUM(units) AS units FROM usage_ledger WHERE at >= ? GROUP BY kind")
      .all(since) as Array<{ kind: string; units: number }>;
    const breakdown: Record<string, number> = {};
    let used = 0;
    for (const row of rows) {
      breakdown[row.kind] = Number(row.units) || 0;
      used += Number(row.units) || 0;
    }
    const remaining = Math.max(0, MONTHLY_UNITS - used);
    sendJson(response, 200, {
      billing: "off",
      enforced: process.env.QUOTA_ENFORCE === "1",
      period: { start: since, end: since.slice(0, 8) + "31", resetsAt: since },
      total: MONTHLY_UNITS,
      used,
      remaining,
      low: remaining < MONTHLY_UNITS * 0.2,
      breakdown,
      today: { used },
    });
  } catch {
    sendJson(response, 503, { error: "quota_unavailable", message: "额度暂时看不到。" });
  } finally {
    db?.close();
  }
  return true;
}
