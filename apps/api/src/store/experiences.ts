import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { indexExperience } from "./search-index.ts";
import { matchExpression, timeWindow } from "./search.ts";
import type { StoredExperience } from "./types.ts";

export interface ExperienceInput {
  kind: string;
  title: string;
  text: string;
  url?: string;
  sourceId?: string;
  sourceSessionId?: string;
  sourceMessageId?: number;
}

export class ExperienceRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  upsertExperience(input: ExperienceInput): StoredExperience {
    const sourceId = input.sourceId ?? `event:${randomUUID()}`;
    const now = new Date().toISOString();
    const chatSource = /^chat:([0-9a-f-]{36}):(\d+)$/iu.exec(sourceId);
    const sessionId = input.sourceSessionId ?? chatSource?.[1];
    const messageId = input.sourceMessageId ?? (chatSource ? Number(chatSource[2]) : undefined);
    const existing = this.db.prepare("SELECT id, created_at AS createdAt FROM memory_experiences WHERE source_id = ?").get(sourceId) as unknown as { id: number; createdAt: string } | undefined;
    let id: number;
    if (existing) {
      id = existing.id;
      this.db.prepare(`
        UPDATE memory_experiences SET kind = ?, title = ?, text = ?, url = ?,
          source_session_id = ?, source_message_id = ?, vector_indexed = 0,
          attempts = 0, last_error = NULL, next_attempt_at = ?, updated_at = ? WHERE id = ?
      `).run(input.kind, input.title, input.text, input.url ?? null, sessionId ?? null, messageId ?? null, now, now, id);
    } else {
      const row = this.db.prepare(`
        INSERT INTO memory_experiences(kind, title, text, url, source_id, source_session_id, source_message_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
      `).get(input.kind, input.title, input.text, input.url ?? null, sourceId, sessionId ?? null, messageId ?? null, now, now) as unknown as { id: number };
      id = row.id;
    }
    indexExperience(this.db, id, `${input.kind} ${input.title} ${input.text}`);
    return this.getExperience(id)!;
  }

  getExperience(id: number): StoredExperience | undefined {
    const row = this.db.prepare(`
      SELECT id, kind, title, text, url, source_id AS sourceId, source_session_id AS sourceSessionId,
        source_message_id AS sourceMessageId, vector_indexed AS vectorIndexed, attempts,
        vector_entry_id AS vectorEntryId, last_error AS lastError, created_at AS createdAt
      FROM memory_experiences WHERE id = ?
    `).get(id) as unknown as (Omit<StoredExperience, "vectorIndexed"> & { vectorIndexed: number }) | undefined;
    return row ? { ...row, vectorIndexed: Boolean(row.vectorIndexed) } : undefined;
  }

  listExperiences(limit = 500, includeChat = true): StoredExperience[] {
    const rows = this.db.prepare(`
      SELECT id FROM memory_experiences ${includeChat ? "" : "WHERE kind <> 'chat'"}
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(limit) as unknown as Array<{ id: number }>;
    return rows.map((row) => this.getExperience(row.id)).filter((row): row is StoredExperience => Boolean(row));
  }

  searchExperiences(query: string, limit = 8, character?: string): Array<StoredExperience & { rank: number }> {
    const match = matchExpression(query);
    const window = timeWindow(query);
    if (!match && !window) return [];
    const filters: string[] = [];
    const params: Array<string | number> = [];
    if (match) {
      filters.push("experience_search MATCH ?");
      params.push(match);
    }
    if (window) {
      filters.push("e.created_at >= ? AND e.created_at < ?");
      params.push(window.from, window.to);
    }
    if (character) {
      filters.push("(e.kind <> 'chat' OR s.character = ?)");
      params.push(character);
      filters.push("(e.source_id NOT LIKE 'learned:chat:%' OR e.source_id LIKE ?)");
      params.push(`learned:chat:${character}:%`);
    }
    const rows = this.db.prepare(`
      SELECT e.id, ${match ? "bm25(experience_search)" : "0"} AS rank FROM experience_search
      JOIN memory_experiences e ON e.id = experience_search.rowid
      LEFT JOIN chat_sessions s ON s.id = e.source_session_id
      WHERE ${filters.join(" AND ")} ORDER BY ${match ? "rank" : "e.created_at DESC"} LIMIT ?
    `).all(...params, limit) as unknown as Array<{ id: number; rank: number }>;
    return rows.map(({ id, rank }) => ({ ...this.getExperience(id)!, rank: Number(rank) }));
  }

  recentExperiences(limit = 3, includeChat = false, character?: string): StoredExperience[] {
    const filters = [includeChat ? "1 = 1" : "e.kind <> 'chat'"];
    const params: Array<string | number> = [];
    if (character) {
      filters.push("(e.kind <> 'chat' OR s.character = ?)");
      params.push(character);
      filters.push("(e.source_id NOT LIKE 'learned:chat:%' OR e.source_id LIKE ?)");
      params.push(`learned:chat:${character}:%`);
    }
    const filteredRows = this.db.prepare(`
      SELECT e.id FROM memory_experiences e LEFT JOIN chat_sessions s ON s.id = e.source_session_id
      WHERE ${filters.join(" AND ")} ORDER BY e.created_at DESC, e.id DESC LIMIT ?
    `).all(...params, limit) as unknown as Array<{ id: number }>;
    return filteredRows.map((row) => this.getExperience(row.id)).filter((row): row is StoredExperience => Boolean(row));
  }

  pendingExperienceIndexes(limit = 50): StoredExperience[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT id FROM memory_experiences
      WHERE vector_indexed = 0 AND next_attempt_at <= ? ORDER BY id LIMIT ?
    `).all(now, limit) as unknown as Array<{ id: number }>;
    return rows.map((row) => this.getExperience(row.id)).filter((row): row is StoredExperience => Boolean(row));
  }

  markExperienceIndexed(id: number, vectorEntryId?: string) {
    this.db.prepare("UPDATE memory_experiences SET vector_indexed = 1, vector_entry_id = COALESCE(?, vector_entry_id), attempts = 0, last_error = NULL, updated_at = ? WHERE id = ?").run(vectorEntryId ?? null, new Date().toISOString(), id);
  }

  experienceBySourceId(sourceId: string): StoredExperience | undefined {
    const row = this.db.prepare("SELECT id FROM memory_experiences WHERE source_id = ?").get(sourceId) as unknown as { id: number } | undefined;
    return row ? this.getExperience(row.id) : undefined;
  }

  experienceVectorIds(kind?: string): string[] {
    const rows = this.db.prepare(`
      SELECT vector_entry_id AS vectorEntryId FROM memory_experiences
      WHERE vector_entry_id IS NOT NULL ${kind ? "AND kind = ?" : ""}
    `).all(...(kind ? [kind] : [])) as unknown as Array<{ vectorEntryId: string }>;
    return rows.map((row) => row.vectorEntryId);
  }

  chatDerivedExperienceVectorIds(): string[] {
    const rows = this.db.prepare(`
      SELECT vector_entry_id AS vectorEntryId FROM memory_experiences
      WHERE vector_entry_id IS NOT NULL AND (kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%')
    `).all() as unknown as Array<{ vectorEntryId: string }>;
    return rows.map((row) => row.vectorEntryId);
  }

  setExperienceVectorId(id: number, vectorEntryId: string | null) {
    this.db.prepare("UPDATE memory_experiences SET vector_entry_id = ?, vector_indexed = ?, attempts = 0, last_error = NULL, updated_at = ? WHERE id = ?").run(vectorEntryId, vectorEntryId ? 1 : 0, new Date().toISOString(), id);
  }

  markExperienceIndexFailed(id: number, error: string) {
    const row = this.db.prepare("SELECT attempts FROM memory_experiences WHERE id = ?").get(id) as unknown as { attempts: number } | undefined;
    if (!row) return;
    const attempts = Number(row.attempts) + 1;
    const retryAt = new Date(Date.now() + Math.min(30_000 * attempts, 3_600_000)).toISOString();
    this.db.prepare(`
      UPDATE memory_experiences SET attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?
    `).run(attempts, error.slice(0, 1000), retryAt, new Date().toISOString(), id);
  }

  removeExperience(id: number): string | undefined {
    const row = this.db.prepare("SELECT source_id AS sourceId FROM memory_experiences WHERE id = ?").get(id) as unknown as { sourceId: string } | undefined;
    if (!row) return undefined;
    this.db.prepare("DELETE FROM experience_search WHERE rowid = ?").run(id);
    this.db.prepare("DELETE FROM experience_search_indexed WHERE experience_id = ?").run(id);
    this.db.prepare("DELETE FROM memory_experiences WHERE id = ?").run(id);
    return row.sourceId;
  }

  removeExperienceBySourceId(sourceId: string) {
    const row = this.db.prepare("SELECT id FROM memory_experiences WHERE source_id = ?").get(sourceId) as unknown as { id: number } | undefined;
    if (row) this.removeExperience(row.id);
  }

  resetVectorIndexes() {
    this.db.exec("UPDATE memory_experiences SET vector_entry_id = NULL, vector_indexed = 0, attempts = 0, last_error = NULL, next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  }
}
