import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * 聊天主库（`app.db`）：消息、近况小记、额度流水、昵称、记忆编号都在这一个文件里。
 * 表都用 `CREATE TABLE IF NOT EXISTS` 建；旧库缺的列用 `PRAGMA table_info` 判断后 `ALTER TABLE ADD COLUMN`。
 */
export function openAppDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      emotion TEXT,
      character TEXT NOT NULL DEFAULT 'whale',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS character_notes (
      character TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      assistant_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS usage_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      units INTEGER NOT NULL,
      character TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_ledger_created ON usage_ledger(created_at);
    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_seq (
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      character TEXT NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (ref_type, ref_id, character),
      UNIQUE (character, seq)
    );
    CREATE TABLE IF NOT EXISTS memory_seq_counter (
      character TEXT PRIMARY KEY,
      last INTEGER NOT NULL
    );
  `);
  // 旧库（没有 character 列）补上，已有记录归给默认角色。
  addColumn(db, "messages", "character", "TEXT NOT NULL DEFAULT 'whale'");
  // B6.3：聊天附件（P5 使用）。旧库补列，旧行是 NULL。
  addColumn(db, "messages", "attachment_json", "TEXT");
  return db;
}

export function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

export function addColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
