import type { DatabaseSync } from "node:sqlite";
import type { MemoryJob, MemoryJobBatch, StoredMessage } from "./types.ts";

export interface MemoryQueueStatus {
  pendingJobs: number;
  retryingJobs: number;
  pendingVectorIndexes: number;
  pendingFactVectorIndexes: number;
}

export class MemoryJobRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  enqueue(input: { sessionId: string; character: string; userMessageId: number; assistantMessageId: number }) {
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_jobs(session_id, character, user_message_id, assistant_message_id)
      VALUES (?, ?, ?, ?)
    `).run(input.sessionId, input.character, input.userMessageId, input.assistantMessageId);
  }

  claim(): MemoryJob | undefined {
    const row = this.db.prepare(`
      UPDATE memory_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE id = (
        SELECT id FROM memory_jobs WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 1
      ) RETURNING id, session_id AS sessionId, character, user_message_id AS userMessageId,
        assistant_message_id AS assistantMessageId, attempts, facts_done AS factsDone,
        vectors_done AS vectorsDone, summary_done AS summaryDone, legacy_done AS legacyDone
    `).get(new Date().toISOString(), new Date().toISOString()) as unknown as (Omit<MemoryJob, "factsDone" | "vectorsDone" | "summaryDone" | "legacyDone"> & { factsDone: number; vectorsDone: number; summaryDone: number; legacyDone: number }) | undefined;
    return row ? {
      ...row,
      factsDone: Boolean(row.factsDone),
      vectorsDone: Boolean(row.vectorsDone),
      summaryDone: Boolean(row.summaryDone),
      legacyDone: Boolean(row.legacyDone),
    } : undefined;
  }

  claimBatch(maxJobs = 8, maxCharacters = 12_000): MemoryJobBatch | undefined {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const first = this.db.prepare(`
        SELECT session_id AS sessionId FROM memory_jobs
        WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 1
      `).get(now) as unknown as { sessionId: string } | undefined;
      if (!first) {
        this.db.exec("COMMIT");
        return undefined;
      }
      const candidates = this.db.prepare(`
        SELECT id, session_id AS sessionId, character, user_message_id AS userMessageId,
          assistant_message_id AS assistantMessageId, attempts, facts_done AS factsDone,
          vectors_done AS vectorsDone, summary_done AS summaryDone, legacy_done AS legacyDone
        FROM memory_jobs WHERE status = 'pending' AND next_attempt_at <= ? AND session_id = ?
        ORDER BY id LIMIT ?
      `).all(now, first.sessionId, maxJobs) as unknown as Array<Record<string, number | string>>;
      const jobs: MemoryJob[] = [];
      const messages: StoredMessage[] = [];
      let characters = 0;
      for (const row of candidates) {
        const pair = this.db.prepare(`
          SELECT id, role, content, emotion, character, session_id AS sessionId, created_at AS createdAt
          FROM messages WHERE id IN (?, ?) ORDER BY id
        `).all(row.userMessageId, row.assistantMessageId) as unknown as StoredMessage[];
        if (pair.length !== 2) {
          jobs.push(this.#job(row));
          continue;
        }
        const pairLength = pair.reduce((sum, message) => sum + message.content.length, 0);
        if (jobs.length > 0 && characters + pairLength > maxCharacters) break;
        if (jobs.length === 0 && pairLength > maxCharacters) {
          const user = pair.find((message) => message.role === "user")!;
          const assistant = pair.find((message) => message.role === "assistant")!;
          const remaining = Math.max(0, maxCharacters - user.content.length);
          pair.splice(0, pair.length, user, { ...assistant, content: assistant.content.slice(0, remaining) });
        }
        jobs.push(this.#job(row));
        messages.push(...pair);
        characters += pair.reduce((sum, message) => sum + message.content.length, 0);
      }
      if (jobs.length === 0) {
        this.db.exec("COMMIT");
        return undefined;
      }
      const update = this.db.prepare("UPDATE memory_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'");
      for (const job of jobs) update.run(now, job.id);
      this.db.exec("COMMIT");
      return { jobs: jobs.map((job) => ({ ...job, attempts: job.attempts + 1 })), messages: messages.sort((a, b) => a.id - b.id) };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markStep(id: number, step: "facts" | "vectors" | "summary" | "legacy") {
    const column = { facts: "facts_done", vectors: "vectors_done", summary: "summary_done", legacy: "legacy_done" }[step];
    this.db.prepare(`UPDATE memory_jobs SET ${column} = 1, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  complete(id: number) {
    this.db.prepare("UPDATE memory_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  fail(id: number, attempts: number, error: string) {
    const retryAt = new Date(Date.now() + Math.min(30_000 * attempts, 3_600_000)).toISOString();
    this.db.prepare(`
      UPDATE memory_jobs SET status = 'pending', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?
    `).run(error.slice(0, 1000), retryAt, new Date().toISOString(), id);
  }

  pause(id: number) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE memory_jobs SET status = 'pending', last_error = NULL, next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(now, now, id);
  }

  hasPending(): boolean {
    const row = this.db.prepare("SELECT 1 AS pending FROM memory_jobs WHERE status != 'done' LIMIT 1").get() as unknown as { pending: number } | undefined;
    return Boolean(row);
  }

  status(): MemoryQueueStatus {
    const jobs = this.db.prepare(`
      SELECT COUNT(*) AS pending, SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS retrying
      FROM memory_jobs WHERE status = 'pending'
    `).get() as unknown as { pending: number; retrying: number | null };
    const indexes = this.db.prepare("SELECT COUNT(*) AS pending FROM memory_experiences WHERE vector_indexed = 0").get() as unknown as { pending: number };
    const facts = this.db.prepare("SELECT COUNT(*) AS pending FROM memory_facts WHERE vector_entry_id IS NULL").get() as unknown as { pending: number };
    return {
      pendingJobs: Number(jobs.pending),
      retryingJobs: Number(jobs.retrying ?? 0),
      pendingVectorIndexes: Number(indexes.pending),
      pendingFactVectorIndexes: Number(facts.pending),
    };
  }

  #job(row: Record<string, number | string>): MemoryJob {
    return {
      id: Number(row.id), sessionId: String(row.sessionId), character: String(row.character),
      userMessageId: Number(row.userMessageId), assistantMessageId: Number(row.assistantMessageId),
      attempts: Number(row.attempts), factsDone: Boolean(row.factsDone), vectorsDone: Boolean(row.vectorsDone),
      summaryDone: Boolean(row.summaryDone), legacyDone: Boolean(row.legacyDone),
    };
  }
}
