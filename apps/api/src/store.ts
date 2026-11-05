import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StoredRole = "user" | "assistant";

export interface StoredMessage {
  id: number;
  role: StoredRole;
  content: string;
  emotion: string | null;
  character: string;
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
        character TEXT NOT NULL DEFAULT 'whale',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS character_notes (
        character TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        assistant_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    // 旧库（没有 character 列）补上，已有记录归给默认角色。
    const columns = this.#db.prepare("PRAGMA table_info(messages)").all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "character")) {
      this.#db.exec("ALTER TABLE messages ADD COLUMN character TEXT NOT NULL DEFAULT 'whale'");
    }
  }

  add(role: StoredRole, content: string, emotion: string | null = null, character = "whale"): StoredMessage {
    const result = this.#db
      .prepare("INSERT INTO messages (role, content, emotion, character) VALUES (?, ?, ?, ?) RETURNING id, role, content, emotion, character, created_at AS createdAt")
      .get(role, content, emotion, character) as unknown as StoredMessage;
    return { ...result };
  }

  /** 某个角色最近 limit 条，按时间从旧到新返回。每个角色有自己的聊天记录。 */
  recent(limit: number, character = "whale"): StoredMessage[] {
    const rows = this.#db
      .prepare("SELECT id, role, content, emotion, character, created_at AS createdAt FROM messages WHERE character = ? ORDER BY id DESC LIMIT ?")
      .all(character, limit) as unknown as StoredMessage[];
    return rows.map((row) => ({ ...row })).reverse();
  }

  /** 角色自己的近况小记（定期反思写下，会慢慢变）。 */
  getNote(character: string): { text: string; assistantCount: number; updatedAt: string } | undefined {
    const row = this.#db.prepare("SELECT text, assistant_count AS assistantCount, updated_at AS updatedAt FROM character_notes WHERE character = ?").get(character) as unknown as { text: string; assistantCount: number; updatedAt: string } | undefined;
    return row ? { ...row } : undefined;
  }

  setNote(character: string, text: string, assistantCount: number) {
    this.#db
      .prepare("INSERT INTO character_notes (character, text, assistant_count) VALUES (?, ?, ?) ON CONFLICT(character) DO UPDATE SET text = excluded.text, assistant_count = excluded.assistant_count, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
      .run(character, text, assistantCount);
  }

  countAssistant(character: string): number {
    const row = this.#db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role = 'assistant' AND character = ?").get(character) as unknown as { n: number };
    return Number(row.n);
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
