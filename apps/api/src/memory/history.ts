import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * mem0 会在 history.db 里另记一份记忆变更历史（含记忆原文）。
 * 「删除我的全部数据」时连同向量一起清空；文件不存在时视为已清空。返回是否成功。
 */
export function clearMem0History(path: string): boolean {
  if (!existsSync(path)) return true;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path);
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
    );
    for (const table of ["memory_history", "messages"]) if (tables.has(table)) db.exec(`DELETE FROM ${table}`);
    return true;
  } catch (error) {
    console.warn("记忆变更历史清理失败：", error instanceof Error ? error.message : error);
    return false;
  } finally {
    db?.close();
  }
}
