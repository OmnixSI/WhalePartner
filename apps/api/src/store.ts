import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StoredRole = "user" | "assistant";

export interface StoredMessage {
  id: number;
  role: StoredRole;
  content: string;
  emotion: string | null;
  createdAt: string;
}

/** 聊天记录。本地原型用 node:sqlite 单文件；":memory:" 用于测试。 */
export class ChatStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        emotion TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
  }

  add(role: StoredRole, content: string, emotion: string | null = null): StoredMessage {
    const result = this.#db
      .prepare("INSERT INTO messages (role, content, emotion) VALUES (?, ?, ?) RETURNING id, role, content, emotion, created_at AS createdAt")
      .get(role, content, emotion) as unknown as StoredMessage;
    return { ...result };
  }

  /** 最近 limit 条，按时间从旧到新返回。 */
  recent(limit: number): StoredMessage[] {
    const rows = this.#db
      .prepare("SELECT id, role, content, emotion, created_at AS createdAt FROM messages ORDER BY id DESC LIMIT ?")
      .all(limit) as unknown as StoredMessage[];
    return rows.map((row) => ({ ...row })).reverse();
  }

  remove(id: number) {
    this.#db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  }

  clear() {
    this.#db.exec("DELETE FROM messages");
  }

  close() {
    this.#db.close();
  }
}
