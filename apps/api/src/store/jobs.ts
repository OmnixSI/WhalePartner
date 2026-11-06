import type { DatabaseSync } from "node:sqlite";
import type { MemoryJob } from "./types.ts";

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
}
