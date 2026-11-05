import type { DatabaseSync } from "node:sqlite";

export function resetVectorIndexes(db: DatabaseSync) {
  db.exec(`
    UPDATE memory_facts SET vector_entry_id = NULL;
    UPDATE memory_experiences SET vector_entry_id = NULL, vector_indexed = 0, attempts = 0,
      last_error = NULL, next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
  `);
}

export function clearChatData(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DELETE FROM memory_jobs;
      DELETE FROM session_observations;
      DELETE FROM character_notes;
      DELETE FROM memory_facts;
      DELETE FROM fact_search;
      DELETE FROM experience_search WHERE rowid IN (SELECT id FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%');
      DELETE FROM experience_search_indexed WHERE experience_id IN (SELECT id FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%');
      DELETE FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%';
      DELETE FROM message_search;
      DELETE FROM message_search_indexed;
      DELETE FROM messages;
      DELETE FROM chat_sessions;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
