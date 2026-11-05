import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface JournalSource {
  id: string;
  type: "chat" | "video" | "web" | "learned" | "reflection";
  title: string;
  text: string;
  createdAt: string;
  sessionId?: string;
  messageId?: number;
  url?: string;
}

export interface DailyJournal {
  id: string;
  character: string;
  localDate: string;
  revision: number;
  text: string;
  sources: JournalSource[];
  modelId: string;
  createdAt: string;
}

interface JournalRow extends Omit<DailyJournal, "sources"> {
  sourcesJson: string;
}

export class JournalStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS daily_journals (
        id TEXT PRIMARY KEY,
        character TEXT NOT NULL,
        local_date TEXT NOT NULL,
        current_revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(character, local_date)
      );
      CREATE TABLE IF NOT EXISTS daily_journal_revisions (
        journal_id TEXT NOT NULL REFERENCES daily_journals(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        text TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        model_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (journal_id, revision)
      );
      CREATE TABLE IF NOT EXISTS daily_journal_sources (
        journal_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
        PRIMARY KEY (journal_id, revision, source_id),
        FOREIGN KEY (journal_id, revision) REFERENCES daily_journal_revisions(journal_id, revision) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS daily_journal_sources_session ON daily_journal_sources(session_id, journal_id);
    `);
  }

  listCurrent(character: string, limit = 100): DailyJournal[] {
    const rows = this.#db.prepare(`
      SELECT j.id, j.character, j.local_date AS localDate, r.revision, r.text,
        r.sources_json AS sourcesJson, r.model_id AS modelId, r.created_at AS createdAt
      FROM daily_journals j JOIN daily_journal_revisions r
        ON r.journal_id = j.id AND r.revision = j.current_revision
      WHERE j.character = ? ORDER BY j.local_date DESC LIMIT ?
    `).all(character, limit) as unknown as JournalRow[];
    return rows.map((row) => this.#asJournal(row));
  }

  current(character: string, localDate: string): DailyJournal | undefined {
    const row = this.#db.prepare(`
      SELECT j.id, j.character, j.local_date AS localDate, r.revision, r.text,
        r.sources_json AS sourcesJson, r.model_id AS modelId, r.created_at AS createdAt
      FROM daily_journals j JOIN daily_journal_revisions r
        ON r.journal_id = j.id AND r.revision = j.current_revision
      WHERE j.character = ? AND j.local_date = ?
    `).get(character, localDate) as unknown as JournalRow | undefined;
    return row ? this.#asJournal(row) : undefined;
  }

  save(input: Omit<DailyJournal, "revision" | "createdAt"> & { modelId: string }, force = false): DailyJournal {
    const now = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("INSERT OR IGNORE INTO daily_journals(id, character, local_date, updated_at) VALUES (?, ?, ?, ?)")
        .run(input.id, input.character, input.localDate, now);
      const current = this.current(input.character, input.localDate);
      const sourceIds = input.sources.map((source) => source.id).sort();
      const oldSourceIds = current?.sources.map((source) => source.id).sort() ?? [];
      if (current && !force && sourceIds.length === oldSourceIds.length && sourceIds.every((id, index) => id === oldSourceIds[index])) {
        this.#db.exec("COMMIT");
        return current;
      }
      const revision = (current?.revision ?? 0) + 1;
      this.#db.prepare(`
        INSERT INTO daily_journal_revisions(journal_id, revision, text, sources_json, model_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.id, revision, input.text, JSON.stringify(input.sources), input.modelId, now);
      const link = this.#db.prepare("INSERT OR IGNORE INTO daily_journal_sources(journal_id, revision, source_id, session_id) VALUES (?, ?, ?, ?)");
      for (const source of input.sources) link.run(input.id, revision, source.id, source.sessionId ?? null);
      this.#db.prepare("UPDATE daily_journals SET current_revision = ?, updated_at = ? WHERE id = ?")
        .run(revision, now, input.id);
      this.#db.exec("COMMIT");
      return { ...input, revision, createdAt: now };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  revisions(journalId: string): DailyJournal[] {
    const rows = this.#db.prepare(`
      SELECT j.id, j.character, j.local_date AS localDate, r.revision, r.text,
        r.sources_json AS sourcesJson, r.model_id AS modelId, r.created_at AS createdAt
      FROM daily_journal_revisions r JOIN daily_journals j ON j.id = r.journal_id
      WHERE j.id = ? ORDER BY r.revision DESC
    `).all(journalId) as unknown as JournalRow[];
    return rows.map((row) => this.#asJournal(row));
  }

  close() {
    this.#db.close();
  }

  #asJournal(row: JournalRow): DailyJournal {
    return { ...row, sources: JSON.parse(row.sourcesJson) as JournalSource[] };
  }
}
