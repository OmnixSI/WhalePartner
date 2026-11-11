import type { DatabaseSync } from "node:sqlite";

export function resetVectorIndexes(db: DatabaseSync) {
  db.exec(`
    UPDATE memory_facts SET vector_entry_id = NULL;
    UPDATE memory_experiences SET vector_entry_id = NULL, vector_indexed = 0, attempts = 0,
      last_error = NULL, next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
  `);
}

/**
 * 「删除我的全部数据」要清空的表，子表在前（外键已开启，surf_items → surf_sessions 没有级联）。
 * 见闻设置、陪伴设置和索引元数据属于配置，不在其中。
 */
const USER_DATA_TABLES = [
  "memory_jobs",
  "session_observations",
  "memory_topic_search",
  "memory_topic_sources",
  "memory_topics",
  "memory_core_sources",
  "memory_core",
  "character_notes",
  "character_moods",
  "fact_search",
  "memory_fact_sources",
  "memory_facts",
  "experience_search",
  "experience_search_indexed",
  "memory_experience_occurrences",
  "memory_experience_sessions",
  "memory_experiences",
  "memory_legacy_sources",
  "memory_seq",
  "memory_seq_counter",
  "relationship_events",
  "relationship_state",
  "proactive_triggers",
  "daily_counters",
  "message_search",
  "message_search_indexed",
  "messages",
  "chat_sessions",
  "daily_journal_sources",
  "daily_journal_revisions",
  "daily_journal_tasks",
  "daily_journals",
  "diary_items",
  "surf_items",
  "surf_sessions",
  "usage_ledger",
  "user_profile",
] as const;

export type UserDataTable = (typeof USER_DATA_TABLES)[number];

/** 导出用：整表读出（只限用户数据表；表不存在时返回空数组，二进制列转成 base64）。 */
export function dumpUserTable(db: DatabaseSync, table: UserDataTable): Array<Record<string, unknown>> {
  if (!(USER_DATA_TABLES as readonly string[]).includes(table)) throw new Error(`不能导出表 ${table}`);
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return [];
  const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value]),
  ));
}

export function clearAllData(db: DatabaseSync) {
  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of USER_DATA_TABLES) if (existing.has(table)) db.exec(`DELETE FROM ${table}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
      DELETE FROM experience_search WHERE rowid IN (SELECT id FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%' OR source_id LIKE 'journal:%');
      DELETE FROM experience_search_indexed WHERE experience_id IN (SELECT id FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%' OR source_id LIKE 'journal:%');
      DELETE FROM memory_experiences WHERE kind = 'chat' OR source_id LIKE 'chat:%' OR source_id LIKE 'learned:chat:%' OR source_id LIKE 'journal:%';
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
