import type { DatabaseSync } from "node:sqlite";
import { indexFact } from "./search-index.ts";
import { matchExpression, normalized, timeWindow } from "./search.ts";
import type { FactCandidate, StoredFact } from "./types.ts";

export class FactRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  saveFacts(sourceMessageId: number, candidates: FactCandidate[]): { facts: StoredFact[]; supersededIds: number[] } {
    const source = this.#message(sourceMessageId);
    if (!source || source.role !== "user") return { facts: [], supersededIds: [] };
    const facts: StoredFact[] = [];
    const supersededIds: number[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const candidate of candidates) {
        const subject = candidate.subject.trim().slice(0, 80);
        const predicate = candidate.predicate.trim().slice(0, 120);
        const value = candidate.value.trim().slice(0, 500);
        const quote = candidate.evidence.trim().slice(0, 500);
        if (!subject || !predicate || !value || !quote || !source.content.includes(quote)) continue;
        const keyRows = this.db.prepare(`
          SELECT id, value FROM memory_facts WHERE subject = ? AND predicate = ? AND status = 'active'
        `).all(subject, predicate) as unknown as Array<{ id: number; value: string }>;
        const existing = keyRows.find((row) => normalized(row.value) === normalized(value));
        if (existing) {
          this.db.prepare("INSERT OR IGNORE INTO memory_fact_sources(fact_id, message_id, quote, recorded_at) VALUES (?, ?, ?, ?)").run(existing.id, source.id, quote, source.createdAt);
          facts.push(this.#factWithSources(existing.id)!);
          continue;
        }
        if (candidate.supersedes) {
          for (const row of keyRows) {
            this.db.prepare("UPDATE memory_facts SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ?").run(source.createdAt, source.createdAt, row.id);
            supersededIds.push(row.id);
          }
        }
        const inserted = this.db.prepare(`
          INSERT INTO memory_facts(subject, predicate, value, kind, confidence, importance, valid_from, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
          RETURNING id
        `).get(subject, predicate, value, candidate.kind, candidate.confidence, candidate.importance, source.createdAt, source.createdAt, source.createdAt) as unknown as { id: number };
        this.db.prepare("INSERT INTO memory_fact_sources(fact_id, message_id, quote, recorded_at) VALUES (?, ?, ?, ?)").run(inserted.id, source.id, quote, source.createdAt);
        indexFact(this.db, inserted.id, `${subject} ${predicate} ${value}`);
        facts.push(this.#factWithSources(inserted.id)!);
      }
      this.db.exec("COMMIT");
      return { facts, supersededIds };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getFact(id: number): StoredFact | undefined {
    return this.#factWithSources(id);
  }

  listFacts(limit = 500): StoredFact[] {
    const rows = this.db.prepare("SELECT id FROM memory_facts ORDER BY updated_at DESC, id DESC LIMIT ?").all(limit) as unknown as Array<{ id: number }>;
    return rows.map((row) => this.#factWithSources(row.id)).filter((row): row is StoredFact => Boolean(row));
  }

  searchFacts(query: string, limit = 8): Array<StoredFact & { rank: number }> {
    const match = matchExpression(query);
    const window = timeWindow(query);
    if (!match && !window) return [];
    const filters: string[] = [];
    const params: Array<string | number> = [];
    if (match) {
      filters.push("fact_search MATCH ?");
      params.push(match);
    }
    if (window) {
      filters.push("f.valid_from < ? AND (f.valid_to IS NULL OR f.valid_to > ?)");
      params.push(window.to, window.from);
    }
    const rows = this.db.prepare(`
      SELECT f.id, ${match ? "bm25(fact_search)" : "0"} AS rank FROM fact_search
      JOIN memory_facts f ON f.id = fact_search.rowid
      WHERE ${filters.join(" AND ")}
      ORDER BY (f.status = 'active') DESC, rank, f.valid_from DESC LIMIT ?
    `).all(...params, limit) as unknown as Array<{ id: number; rank: number }>;
    return rows.map(({ id, rank }) => ({ ...this.#factWithSources(id)!, rank: Number(rank) }));
  }

  removeFact(id: number) {
    this.db.prepare("DELETE FROM fact_search WHERE rowid = ?").run(id);
    this.db.prepare("DELETE FROM memory_facts WHERE id = ?").run(id);
  }

  setFactVectorId(id: number, vectorEntryId: string | null) {
    this.db.prepare("UPDATE memory_facts SET vector_entry_id = ?, updated_at = ? WHERE id = ?").run(vectorEntryId, new Date().toISOString(), id);
  }

  factVectorId(id: number): string | undefined {
    const row = this.db.prepare("SELECT vector_entry_id AS vectorEntryId FROM memory_facts WHERE id = ?").get(id) as unknown as { vectorEntryId?: string } | undefined;
    return row?.vectorEntryId;
  }

  factVectorIds(): string[] {
    const rows = this.db.prepare("SELECT vector_entry_id AS vectorEntryId FROM memory_facts WHERE vector_entry_id IS NOT NULL").all() as unknown as Array<{ vectorEntryId: string }>;
    return rows.map((row) => row.vectorEntryId);
  }

  pendingFacts(afterId = 0, limit = 50): StoredFact[] {
    const rows = this.db.prepare("SELECT id FROM memory_facts WHERE vector_entry_id IS NULL AND id > ? ORDER BY id LIMIT ?").all(afterId, limit) as unknown as Array<{ id: number }>;
    return rows.map((row) => this.#factWithSources(row.id)).filter((row): row is StoredFact => Boolean(row));
  }

  resetVectorIndexes() {
    this.db.exec("UPDATE memory_facts SET vector_entry_id = NULL");
  }

  #factWithSources(id: number): StoredFact | undefined {
    const row = this.db.prepare(`
      SELECT id, subject, predicate, value, kind, confidence, importance,
             valid_from AS validFrom, valid_to AS validTo, status, vector_entry_id AS vectorEntryId,
             created_at AS createdAt
      FROM memory_facts WHERE id = ?
    `).get(id) as unknown as Omit<StoredFact, "sources"> | undefined;
    if (!row) return undefined;
    const sources = this.db.prepare(`
      SELECT fs.message_id AS messageId, m.session_id AS sessionId, m.character AS character,
             m.created_at AS createdAt, fs.quote
      FROM memory_fact_sources fs JOIN messages m ON m.id = fs.message_id
      WHERE fs.fact_id = ? ORDER BY fs.recorded_at DESC
    `).all(id) as unknown as StoredFact["sources"];
    return { ...row, sources: sources.map((source) => ({ ...source })) };
  }

  #message(id: number) {
    return this.db.prepare("SELECT id, role, content, created_at AS createdAt FROM messages WHERE id = ?").get(id) as unknown as { id: number; role: string; content: string; createdAt: string } | undefined;
  }
}
