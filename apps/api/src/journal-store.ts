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

export interface DailyJournalTask {
  character: string;
  localDate: string;
  status: "pending" | "running" | "complete" | "failed";
  attempts: number;
  bodySaved: boolean;
  force: boolean;
  lastError: string | null;
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
      CREATE TABLE IF NOT EXISTS daily_journal_tasks (
        character TEXT NOT NULL,
        local_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        body_saved INTEGER NOT NULL DEFAULT 0,
        force INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (character, local_date)
      );
      CREATE INDEX IF NOT EXISTS daily_journal_tasks_pending ON daily_journal_tasks(status, updated_at);
    `);
  }

  listCurrent(character?: string, options: { from?: string; to?: string; limit?: number; offset?: number } = {}): { items: DailyJournal[]; total: number } {
    const from = options.from ?? "0000-01-01";
    const to = options.to ?? "9999-12-31";
    const limit = Math.max(1, Math.min(366, Math.trunc(options.limit ?? 100)));
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const scope = character ? "j.character = ? AND" : "";
    const params = character ? [character, from, to] : [from, to];
    const rows = this.#db.prepare(`
      WITH selected AS (
        SELECT j.*, ROW_NUMBER() OVER (
          PARTITION BY j.local_date ORDER BY j.updated_at DESC, j.character = 'shared' DESC, j.id DESC
        ) AS day_rank
        FROM daily_journals j
        WHERE ${scope} j.local_date >= ? AND j.local_date <= ?
      )
      SELECT j.id, j.character, j.local_date AS localDate, r.revision, r.text,
        r.sources_json AS sourcesJson, r.model_id AS modelId, r.created_at AS createdAt
      FROM selected j JOIN daily_journal_revisions r
        ON r.journal_id = j.id AND r.revision = j.current_revision
      WHERE j.day_rank = 1
      ORDER BY j.local_date DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as unknown as JournalRow[];
    const total = this.#db.prepare(`
      SELECT COUNT(DISTINCT local_date) AS count FROM daily_journals
      WHERE ${character ? "character = ? AND" : ""} local_date >= ? AND local_date <= ?
    `).get(...params) as unknown as { count: number };
    return { items: rows.map((row) => this.#asJournal(row)), total: Number(total.count) };
  }

  task(character: string, localDate: string): DailyJournalTask | undefined {
    const row = this.#db.prepare(`
      SELECT character, local_date AS localDate, status, attempts,
        body_saved AS bodySaved, force, last_error AS lastError
      FROM daily_journal_tasks WHERE character = ? AND local_date = ?
    `).get(character, localDate) as unknown as (Omit<DailyJournalTask, "bodySaved" | "force"> & { bodySaved: number; force: number }) | undefined;
    return row ? { ...row, bodySaved: Boolean(row.bodySaved), force: Boolean(row.force) } : undefined;
  }

  enqueueTask(character: string, localDate: string, force = false) {
    const now = new Date().toISOString();
    this.#db.prepare(`
      INSERT INTO daily_journal_tasks(character, local_date, status, attempts, body_saved, force, updated_at)
      VALUES (?, ?, 'pending', 0, 0, ?, ?)
      ON CONFLICT(character, local_date) DO UPDATE SET
        status = CASE WHEN daily_journal_tasks.status IN ('complete','failed') THEN 'pending' ELSE daily_journal_tasks.status END,
        attempts = CASE WHEN daily_journal_tasks.status = 'complete' THEN 0 ELSE daily_journal_tasks.attempts END,
        body_saved = CASE WHEN daily_journal_tasks.status = 'complete' THEN 0 ELSE daily_journal_tasks.body_saved END,
        force = MAX(daily_journal_tasks.force, excluded.force),
        last_error = NULL,
        updated_at = excluded.updated_at
    `).run(character, localDate, force ? 1 : 0, now);
  }

  claimTask(character: string, localDate: string): boolean {
    const result = this.#db.prepare(`
      UPDATE daily_journal_tasks SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE character = ? AND local_date = ? AND status IN ('pending','failed')
    `).run(new Date().toISOString(), character, localDate);
    return Number(result.changes) === 1;
  }

  recoverInterruptedTasks() {
    this.#db.prepare("UPDATE daily_journal_tasks SET status = 'pending', updated_at = ? WHERE status = 'running'")
      .run(new Date().toISOString());
  }

  incompleteTasks(limit = 100): DailyJournalTask[] {
    const rows = this.#db.prepare(`
      SELECT character, local_date AS localDate, status, attempts,
        body_saved AS bodySaved, force, last_error AS lastError
      FROM daily_journal_tasks WHERE status IN ('pending','failed')
      ORDER BY updated_at, local_date LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.trunc(limit)))) as unknown as Array<Omit<DailyJournalTask, "bodySaved" | "force"> & { bodySaved: number; force: number }>;
    return rows.map((row) => ({ ...row, bodySaved: Boolean(row.bodySaved), force: Boolean(row.force) }));
  }

  markBodySaved(character: string, localDate: string) {
    this.#db.prepare("UPDATE daily_journal_tasks SET body_saved = 1, updated_at = ? WHERE character = ? AND local_date = ?")
      .run(new Date().toISOString(), character, localDate);
  }

  completeTask(character: string, localDate: string) {
    this.#db.prepare(`
      UPDATE daily_journal_tasks SET status = 'complete', body_saved = 1, force = 0,
        last_error = NULL, updated_at = ? WHERE character = ? AND local_date = ?
    `).run(new Date().toISOString(), character, localDate);
  }

  failTask(character: string, localDate: string, error: string) {
    this.#db.prepare(`
      UPDATE daily_journal_tasks SET status = 'failed', last_error = ?, updated_at = ?
      WHERE character = ? AND local_date = ?
    `).run(error.slice(0, 1_000), new Date().toISOString(), character, localDate);
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

  currentForDate(localDate: string): DailyJournal | undefined {
    const row = this.#db.prepare(`
      SELECT j.id, j.character, j.local_date AS localDate, r.revision, r.text,
        r.sources_json AS sourcesJson, r.model_id AS modelId, r.created_at AS createdAt
      FROM daily_journals j JOIN daily_journal_revisions r
        ON r.journal_id = j.id AND r.revision = j.current_revision
      WHERE j.local_date = ?
      ORDER BY j.updated_at DESC, j.character = 'shared' DESC, j.id DESC LIMIT 1
    `).get(localDate) as unknown as JournalRow | undefined;
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
        this.#db.prepare("UPDATE daily_journal_tasks SET body_saved = 1, updated_at = ? WHERE character = ? AND local_date = ?")
          .run(now, input.character, input.localDate);
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
      this.#db.prepare("UPDATE daily_journal_tasks SET body_saved = 1, updated_at = ? WHERE character = ? AND local_date = ?")
        .run(now, input.character, input.localDate);
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
