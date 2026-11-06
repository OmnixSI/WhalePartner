import { rmSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { AccountService } from "./accounts.ts";
import { tableExists } from "./db.ts";
import type { MemoryStore } from "./memory/types.ts";

/** “删除全部数据”要清空的表。配置和 `.env` 不在里面。 */
export const CLEAR_TABLES = [
  "messages",
  "character_notes",
  "diary_items",
  "user_profile",
  "usage_ledger",
  "memory_seq",
  "memory_seq_counter",
] as const;

export interface ClearAllDeps {
  db: DatabaseSync;
  memory?: MemoryStore;
  accounts?: AccountService;
  /** 有些数据落在磁盘目录里（例如冲浪缩略图），存在就整个删掉。 */
  surfDir?: string;
}

/**
 * 删除全部用户数据（B2）：一个事务清空白名单表，再删记忆库条目、磁盘目录，并登出 B 站。
 * 不删除配置、不删除 `.env`、不碰登录凭据文件以外的东西。
 */
export async function clearAllData(deps: ClearAllDeps): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  deps.db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of CLEAR_TABLES) {
      if (!tableExists(deps.db, table)) continue;
      const row = deps.db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as unknown as { n: number };
      deps.db.prepare(`DELETE FROM "${table}"`).run();
      deleted[table] = Number(row.n);
    }
    deps.db.exec("COMMIT");
  } catch (error) {
    deps.db.exec("ROLLBACK");
    throw error;
  }

  if (deps.memory) {
    try {
      for (const entry of await deps.memory.list()) await deps.memory.remove(entry.id);
    } catch (error) {
      console.warn("清空记忆库失败（本地数据表已清空）：", error instanceof Error ? error.message : error);
    }
  }
  if (deps.surfDir) {
    try {
      rmSync(deps.surfDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("删除冲浪目录失败：", error instanceof Error ? error.message : error);
    }
  }
  if (deps.accounts) {
    try {
      await deps.accounts.logout("bilibili");
    } catch (error) {
      console.warn("删除全部数据时登出 B 站失败：", error instanceof Error ? error.message : error);
    }
  }
  return deleted;
}
