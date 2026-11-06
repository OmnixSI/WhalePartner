import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { indexMessage } from "./search-index.ts";
import { matchExpression, timeWindow } from "./search.ts";
import type { ArchiveHit, ChatSession, StoredMessage, StoredRole } from "./types.ts";

export class SessionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  createSession(character: string, title = "新聊天"): ChatSession {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO chat_sessions (id, character, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, character, title, now, now);
    return { id, character, title, titleManual: false, createdAt: now, updatedAt: now, messageCount: 0 };
  }

  renameSession(id: string, character: string, title: string): ChatSession | undefined {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE chat_sessions SET title = ?, title_manual = 1, updated_at = ?
      WHERE id = ? AND character = ?
    `).run(title, now, id, character);
    return Number(result.changes) > 0 ? this.getSession(id, character) : undefined;
  }

  getSession(id: string, character?: string): ChatSession | undefined {
    const row = this.db.prepare(`
      SELECT s.id, s.character, s.title, s.title_manual AS titleManual, s.created_at AS createdAt, s.updated_at AS updatedAt,
             COUNT(m.id) AS messageCount
      FROM chat_sessions s LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.id = ? ${character ? "AND s.character = ?" : ""}
      GROUP BY s.id
    `).get(...(character ? [id, character] : [id])) as unknown as (ChatSession & { messageCount: number }) | undefined;
    return row ? { ...row, titleManual: Boolean(row.titleManual), messageCount: Number(row.messageCount) } : undefined;
  }

  getOrCreateSession(character: string, id?: string): ChatSession {
    if (id) {
      const session = this.getSession(id, character);
      if (!session) throw new Error("没有找到这个角色的聊天会话。");
      return session;
    }
    const latest = this.db.prepare("SELECT id FROM chat_sessions WHERE character = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1").get(character) as unknown as { id: string } | undefined;
    return latest ? this.getSession(latest.id, character)! : this.createSession(character);
  }

  listSessions(character: string, limit = 100): ChatSession[] {
    const rows = this.db.prepare(`
      SELECT s.id, s.character, s.title, s.title_manual AS titleManual, s.created_at AS createdAt, s.updated_at AS updatedAt,
             COUNT(m.id) AS messageCount
      FROM chat_sessions s LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.character = ? GROUP BY s.id
      ORDER BY s.updated_at DESC, s.created_at DESC LIMIT ?
    `).all(character, limit) as unknown as Array<ChatSession & { messageCount: number }>;
    return rows.map((row) => ({ ...row, titleManual: Boolean(row.titleManual), messageCount: Number(row.messageCount) }));
  }

  add(role: StoredRole, content: string, emotion: string | null = null, character = "whale", sessionId?: string): StoredMessage {
    const session = this.getOrCreateSession(character, sessionId);
    const result = this.db.prepare(`
      INSERT INTO messages (role, content, emotion, character, session_id)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, role, content, emotion, character, session_id AS sessionId, created_at AS createdAt
    `).get(role, content, emotion, character, session.id) as unknown as StoredMessage;
    indexMessage(this.db, result.id, content);
    if (role === "user") {
      const title = content.replace(/\s+/g, " ").trim().slice(0, 40) || "新聊天";
      this.db.prepare(`
        UPDATE chat_sessions SET title = CASE WHEN title_manual = 0 AND title IN ('新聊天','历史聊天') THEN ? ELSE title END,
          updated_at = ? WHERE id = ?
      `).run(title, result.createdAt, session.id);
    } else {
      this.db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(result.createdAt, session.id);
    }
    return { ...result };
  }

  recent(limit: number, character = "whale", sessionId?: string): StoredMessage[] {
    const where = sessionId ? "session_id = ?" : "character = ?";
    const rows = this.db.prepare(`
      SELECT id, role, content, emotion, character, session_id AS sessionId, created_at AS createdAt
      FROM messages WHERE ${where} ORDER BY id DESC LIMIT ?
    `).all(sessionId ?? character, limit) as unknown as StoredMessage[];
    return rows.map((row) => ({ ...row })).reverse();
  }

  messagesBetween(sessionId: string, fromId: number, throughId: number): StoredMessage[] {
    const rows = this.db.prepare(`
      SELECT id, role, content, emotion, character, session_id AS sessionId, created_at AS createdAt
      FROM messages WHERE session_id = ? AND id BETWEEN ? AND ? ORDER BY id
    `).all(sessionId, fromId, throughId) as unknown as StoredMessage[];
    return rows.map((row) => ({ ...row }));
  }

  messagesAround(sessionId: string, messageId: number, radius = 50): StoredMessage[] | undefined {
    const exists = this.db.prepare("SELECT 1 FROM messages WHERE id = ? AND session_id = ?").get(messageId, sessionId);
    if (!exists) return undefined;
    const before = this.db.prepare(`
      SELECT id, role, content, emotion, character, session_id AS sessionId, created_at AS createdAt
      FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?
    `).all(sessionId, messageId, radius) as unknown as StoredMessage[];
    const after = this.db.prepare(`
      SELECT id, role, content, emotion, character, session_id AS sessionId, created_at AS createdAt
      FROM messages WHERE session_id = ? AND id >= ? ORDER BY id LIMIT ?
    `).all(sessionId, messageId, radius + 1) as unknown as StoredMessage[];
    return [...before.reverse(), ...after].map((row) => ({ ...row }));
  }

  message(id: number): StoredMessage | undefined {
    const row = this.db.prepare(`
      SELECT id, role, content, emotion, character, session_id AS sessionId, created_at AS createdAt
      FROM messages WHERE id = ?
    `).get(id) as unknown as StoredMessage | undefined;
    return row ? { ...row } : undefined;
  }

  remove(id: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM message_search WHERE rowid = ?").run(id);
      this.db.prepare("DELETE FROM message_search_indexed WHERE message_id = ?").run(id);
      this.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
      this.db.prepare(`
        UPDATE memory_experiences AS e SET
          source_session_id = (SELECT session_id FROM memory_experience_occurrences WHERE experience_id = e.id ORDER BY occurred_at DESC, id DESC LIMIT 1),
          source_message_id = (SELECT message_id FROM memory_experience_occurrences WHERE experience_id = e.id ORDER BY occurred_at DESC, id DESC LIMIT 1),
          source_missing = CASE WHEN EXISTS (SELECT 1 FROM memory_experience_occurrences WHERE experience_id = e.id) THEN 0 ELSE 1 END
        WHERE e.source_message_id = ?
      `).run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  searchArchive(query: string, limit = 6, excludeSessionId?: string, character?: string): ArchiveHit[] {
    const match = matchExpression(query);
    const window = timeWindow(query);
    if (!match && !window) return [];
    const filters: string[] = [];
    const params: Array<string | number> = [];
    if (match) {
      filters.push("message_search MATCH ?");
      params.push(match);
    }
    if (window) {
      filters.push("m.created_at >= ? AND m.created_at < ?");
      params.push(window.from, window.to);
    }
    if (excludeSessionId) {
      filters.push("m.session_id <> ?");
      params.push(excludeSessionId);
    }
    if (character) {
      filters.push("m.character = ?");
      params.push(character);
    }
    const rows = this.db.prepare(`
      SELECT m.id, m.role, m.content, m.emotion, m.character, m.session_id AS sessionId,
             m.created_at AS createdAt, s.title AS sessionTitle, ${match ? "bm25(message_search)" : "0"} AS rank
      FROM message_search JOIN messages m ON m.id = message_search.rowid
      JOIN chat_sessions s ON s.id = m.session_id
      WHERE ${filters.join(" AND ")}
      ORDER BY ${match ? "rank" : "m.created_at DESC"} LIMIT ?
    `).all(...params, limit) as unknown as Array<StoredMessage & { sessionTitle: string; rank: number }>;
    return rows.map((row) => ({ message: { ...row }, sessionTitle: row.sessionTitle, rank: Number(row.rank) }));
  }

  getNote(character: string): { text: string; assistantCount: number; updatedAt: string } | undefined {
    const row = this.db.prepare("SELECT text, assistant_count AS assistantCount, updated_at AS updatedAt FROM character_notes WHERE character = ?").get(character) as unknown as { text: string; assistantCount: number; updatedAt: string } | undefined;
    return row ? { ...row } : undefined;
  }

  setNote(character: string, text: string, assistantCount: number) {
    this.db.prepare(`
      INSERT INTO character_notes (character, text, assistant_count) VALUES (?, ?, ?)
      ON CONFLICT(character) DO UPDATE SET text = excluded.text, assistant_count = excluded.assistant_count,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).run(character, text, assistantCount);
  }

  countAssistant(character: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE role = 'assistant' AND character = ?").get(character) as unknown as { n: number };
    return Number(row.n);
  }
}
