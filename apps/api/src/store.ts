import { DatabaseSync } from "node:sqlite";
import { openAppDatabase } from "./db.ts";

export type StoredRole = "user" | "assistant";

export interface StoredMessage {
  id: number;
  role: StoredRole;
  content: string;
  emotion: string | null;
  character: string;
  createdAt: string;
  /** B6.3：随消息附带的材料（例如看过的视频）；没有就是 null。 */
  attachment: unknown;
}

interface MessageRow {
  id: number;
  role: StoredRole;
  content: string;
  emotion: string | null;
  character: string;
  createdAt: string;
  attachmentJson: string | null;
}

/** 聊天记录。本地原型用 node:sqlite 单文件；":memory:" 用于测试。 */
export class ChatStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = openAppDatabase(path);
  }

  /** 同一个库里的额度、昵称、记忆编号也通过它读写。 */
  get db(): DatabaseSync {
    return this.#db;
  }

  add(role: StoredRole, content: string, emotion: string | null = null, character = "whale", attachment: unknown = null): StoredMessage {
    const result = this.#db
      .prepare("INSERT INTO messages (role, content, emotion, character, attachment_json) VALUES (?, ?, ?, ?, ?) RETURNING id, role, content, emotion, character, created_at AS createdAt")
      .get(role, content, emotion, character, attachment === null ? null : JSON.stringify(attachment)) as unknown as Omit<StoredMessage, "attachment">;
    return { ...result, attachment };
  }

  /** 某个角色最近 limit 条，按时间从旧到新返回。每个角色有自己的聊天记录。 */
  recent(limit: number, character = "whale"): StoredMessage[] {
    const rows = this.#db
      .prepare("SELECT id, role, content, emotion, character, created_at AS createdAt, attachment_json AS attachmentJson FROM messages WHERE character = ? ORDER BY id DESC LIMIT ?")
      .all(character, limit) as unknown as MessageRow[];
    return rows.map((row) => {
      const { attachmentJson, ...rest } = row;
      return { ...rest, attachment: parseAttachment(attachmentJson) };
    }).reverse();
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

function parseAttachment(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
