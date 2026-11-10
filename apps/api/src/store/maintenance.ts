import type { DatabaseSync } from "node:sqlite";

export function resetVectorIndexes(db: DatabaseSync) {
  db.exec(`
    UPDATE memory_facts SET vector_entry_id = NULL;
    UPDATE memory_experiences SET vector_entry_id = NULL, vector_indexed = 0, attempts = 0,
      last_error = NULL, next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
  `);
}

export function clearChatData(db: DatabaseSync) {
  const hasDailyJournals = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'daily_journals'").get());
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DELETE FROM memory_jobs;
      DELETE FROM session_observations;
      DELETE FROM memory_topic_search;
      DELETE FROM memory_topics;
      DELETE FROM memory_core;
      DELETE FROM character_notes;
      DELETE FROM memory_facts;
      DELETE FROM fact_search;
      DELETE FROM experience_search WHERE rowid IN (SELECT id FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%');
      DELETE FROM experience_search_indexed WHERE experience_id IN (SELECT id FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%');
      DELETE FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%';
      UPDATE memory_experiences
      SET source_session_id = NULL, source_message_id = NULL, source_missing = 1
      WHERE kind <> 'chat'
        AND (source_session_id IS NOT NULL OR EXISTS (
          SELECT 1 FROM memory_experience_sessions es WHERE es.experience_id = memory_experiences.id
        ));
      DELETE FROM message_search;
      DELETE FROM message_search_indexed;
      DELETE FROM messages;
      DELETE FROM chat_sessions;
    `);
    if (hasDailyJournals) db.exec("DELETE FROM daily_journals");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
