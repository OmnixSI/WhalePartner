import type { DatabaseSync } from "node:sqlite";
import type { StoredMessage } from "./types.ts";

export interface ObservationInput {
  previous?: string;
  throughMessageId: number;
  messages: StoredMessage[];
}

export interface StoredObservation {
  summary: string;
  fromMessageId: number;
  throughMessageId: number;
  updatedAt: string;
}

export class ObservationRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(sessionId: string): StoredObservation | undefined {
    const row = this.db.prepare(`
      SELECT summary, from_message_id AS fromMessageId, through_message_id AS throughMessageId,
             updated_at AS updatedAt FROM session_observations WHERE session_id = ?
    `).get(sessionId) as unknown as StoredObservation | undefined;
    return row ? { ...row } : undefined;
  }

  input(sessionId: string, keepRecent = 8): ObservationInput | undefined {
    const cutoff = this.db.prepare(`
      SELECT id FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?
    `).get(sessionId, keepRecent - 1) as unknown as { id: number } | undefined;
    if (!cutoff) return undefined;
    const current = this.get(sessionId);
    const throughMessageId = current?.throughMessageId ?? 0;
    if (cutoff.id <= throughMessageId) return undefined;
    const rows = this.db.prepare(`
      SELECT id, role, content, emotion, character, session_id AS sessionId, created_at AS createdAt
      FROM messages WHERE session_id = ? AND id > ? AND id < ? ORDER BY id LIMIT 32
    `).all(sessionId, throughMessageId, cutoff.id) as unknown as StoredMessage[];
    const messages: StoredMessage[] = [];
    let characters = 0;
    for (const row of rows) {
      const content = row.content.length > 6_000
        ? `${row.content.slice(0, 4_500)}\n（原文较长，完整内容仍可在本机归档中检索）\n${row.content.slice(-1_000)}`
        : row.content;
      if (messages.length > 0 && characters + content.length > 12_000) break;
      messages.push({ ...row, content });
      characters += content.length;
    }
    if (messages.length === 0) return undefined;
    return { ...(current ? { previous: current.summary } : {}), throughMessageId: messages.at(-1)!.id, messages };
  }

  save(sessionId: string, summary: string, fromMessageId: number, throughMessageId: number) {
    this.db.prepare(`
      INSERT INTO session_observations(session_id, summary, from_message_id, through_message_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary,
        from_message_id = MIN(session_observations.from_message_id, excluded.from_message_id),
        through_message_id = excluded.through_message_id, updated_at = excluded.updated_at
    `).run(sessionId, summary, fromMessageId, throughMessageId, new Date().toISOString());
  }

  /** 会话观察（每个会话一条摘要），新的在前。 */
  list(): Array<{ sessionId: string; sessionTitle: string; summary: string; updatedAt: string }> {
    const rows = this.db.prepare(`
      SELECT o.session_id AS sessionId, s.title AS sessionTitle, o.summary, o.updated_at AS updatedAt
      FROM session_observations o JOIN chat_sessions s ON s.id = o.session_id
      ORDER BY o.updated_at DESC
    `).all() as unknown as Array<{ sessionId: string; sessionTitle: string; summary: string; updatedAt: string }>;
    return rows.map((row) => ({ ...row }));
  }
}
