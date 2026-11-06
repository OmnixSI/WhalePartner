import type { DatabaseSync } from "node:sqlite";

export interface SessionDeletion {
  character: string;
  experienceVectorIds: string[];
  legacyVectorIds: string[];
  remainingAssistantCount: number;
  affectedJournals: Array<{ character: string; localDate: string }>;
}

interface SessionRow {
  character: string;
}

interface ExperienceRow {
  id: number;
  kind: string;
  sourceId: string;
  vectorEntryId: string | null;
}

const isChatMemory = (row: Pick<ExperienceRow, "kind" | "sourceId">) =>
  row.kind === "chat" || row.sourceId.startsWith("chat:") || row.sourceId.startsWith("learned:chat:") || row.sourceId.startsWith("journal:");

export function deleteChatSession(db: DatabaseSync, sessionId: string, character: string): SessionDeletion | undefined {
  const session = db.prepare("SELECT character FROM chat_sessions WHERE id = ? AND character = ?")
    .get(sessionId, character) as unknown as SessionRow | undefined;
  if (!session) return undefined;

  const legacyVectorIds = (db.prepare("SELECT vector_entry_id AS vectorEntryId FROM memory_legacy_sources WHERE session_id = ?")
    .all(sessionId) as unknown as Array<{ vectorEntryId: string }>).map((row) => row.vectorEntryId);
  const experiences = db.prepare(`
    SELECT DISTINCT e.id, e.kind, e.source_id AS sourceId, e.vector_entry_id AS vectorEntryId
    FROM memory_experiences e
    LEFT JOIN memory_experience_sessions es ON es.experience_id = e.id
    WHERE e.source_session_id = ? OR es.session_id = ?
  `).all(sessionId, sessionId) as unknown as ExperienceRow[];
  const experienceVectorIds: string[] = [];
  const orphanLegacyVectorIds: string[] = [];
  const hasJournalSources = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'daily_journal_sources'").get());
  const affectedJournals = hasJournalSources
    ? db.prepare(`
        SELECT DISTINCT j.character, j.local_date AS localDate
        FROM daily_journals j JOIN daily_journal_sources js ON js.journal_id = j.id
        WHERE js.session_id = ? ORDER BY j.local_date
      `).all(sessionId) as unknown as Array<{ character: string; localDate: string }>
    : [];

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM memory_legacy_sources WHERE session_id = ?").run(sessionId);
    for (const vectorEntryId of legacyVectorIds) {
      const remaining = db.prepare("SELECT 1 FROM memory_legacy_sources WHERE vector_entry_id = ? LIMIT 1").get(vectorEntryId);
      if (!remaining) orphanLegacyVectorIds.push(vectorEntryId);
    }

    db.prepare("DELETE FROM memory_experience_sessions WHERE session_id = ?").run(sessionId);
    for (const experience of experiences) {
      const remaining = db.prepare("SELECT session_id FROM memory_experience_sessions WHERE experience_id = ? ORDER BY session_id LIMIT 1")
        .get(experience.id) as unknown as { session_id: string } | undefined;
      if (experience.sourceId.startsWith("journal:")) {
        if (experience.vectorEntryId) experienceVectorIds.push(experience.vectorEntryId);
        db.prepare("DELETE FROM experience_search WHERE rowid = ?").run(experience.id);
        db.prepare("DELETE FROM experience_search_indexed WHERE experience_id = ?").run(experience.id);
        db.prepare("DELETE FROM memory_experiences WHERE id = ?").run(experience.id);
      } else if (remaining) {
        db.prepare(`
          UPDATE memory_experiences
          SET source_session_id = CASE WHEN source_session_id = ? THEN ? ELSE source_session_id END,
              source_missing = 0,
              source_message_id = CASE WHEN source_session_id = ? THEN (
                SELECT message_id FROM memory_experience_occurrences
                WHERE experience_id = ? AND session_id = ? ORDER BY occurred_at DESC LIMIT 1
              ) ELSE source_message_id END
          WHERE id = ?
        `).run(sessionId, remaining.session_id, sessionId, experience.id, remaining.session_id, experience.id);
      } else if (isChatMemory(experience)) {
        if (experience.vectorEntryId) experienceVectorIds.push(experience.vectorEntryId);
        db.prepare("DELETE FROM experience_search WHERE rowid = ?").run(experience.id);
        db.prepare("DELETE FROM experience_search_indexed WHERE experience_id = ?").run(experience.id);
        db.prepare("DELETE FROM memory_experiences WHERE id = ?").run(experience.id);
      } else {
        db.prepare("UPDATE memory_experiences SET source_session_id = NULL, source_message_id = NULL, source_missing = 1 WHERE id = ? AND source_session_id = ?")
          .run(experience.id, sessionId);
      }
    }

    db.prepare("DELETE FROM message_search WHERE rowid IN (SELECT id FROM messages WHERE session_id = ?)").run(sessionId);
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);

    const orphanFacts = db.prepare(`
      SELECT f.id, f.vector_entry_id AS vectorEntryId FROM memory_facts f
      WHERE NOT EXISTS (SELECT 1 FROM memory_fact_sources fs WHERE fs.fact_id = f.id)
    `).all() as unknown as Array<{ id: number; vectorEntryId: string | null }>;
    for (const fact of orphanFacts) {
      if (fact.vectorEntryId) experienceVectorIds.push(fact.vectorEntryId);
      db.prepare("DELETE FROM fact_search WHERE rowid = ?").run(fact.id);
      db.prepare("DELETE FROM memory_facts WHERE id = ?").run(fact.id);
    }

    db.prepare("DELETE FROM character_notes WHERE character = ?").run(character);
    if (hasJournalSources) {
      db.prepare(`
        DELETE FROM daily_journals WHERE id IN (
          SELECT DISTINCT journal_id FROM daily_journal_sources WHERE session_id = ?
        )
      `).run(sessionId);
    }
    db.prepare("DELETE FROM chat_sessions WHERE id = ? AND character = ?").run(sessionId, character);
    const remaining = db.prepare("SELECT COUNT(*) AS count FROM messages WHERE character = ? AND role = 'assistant'")
      .get(character) as unknown as { count: number };
    db.exec("COMMIT");
    return {
      character: session.character,
      experienceVectorIds: [...new Set(experienceVectorIds)],
      legacyVectorIds: [...new Set(orphanLegacyVectorIds)],
      remainingAssistantCount: Number(remaining.count),
      affectedJournals,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
