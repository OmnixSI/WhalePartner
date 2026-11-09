import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openChatDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      emotion TEXT,
      character TEXT NOT NULL DEFAULT 'whale',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS character_notes (
      character TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      assistant_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      character TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title_manual INTEGER NOT NULL DEFAULT 0
    );
  `);

  migrateMessages(db);
  migrateSessions(db);
  db.exec(`
    INSERT OR IGNORE INTO chat_sessions (id, character, title, created_at, updated_at)
    SELECT 'legacy:' || character, character, '历史聊天', MIN(created_at), MAX(created_at)
    FROM messages WHERE session_id IS NULL GROUP BY character;
    UPDATE messages SET session_id = 'legacy:' || character WHERE session_id IS NULL;
    CREATE INDEX IF NOT EXISTS messages_session_id_id ON messages(session_id, id);
    CREATE INDEX IF NOT EXISTS messages_character_id ON messages(character, id);
    CREATE INDEX IF NOT EXISTS messages_created_at ON messages(created_at);

    CREATE TABLE IF NOT EXISTS session_observations (
      session_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      from_message_id INTEGER NOT NULL,
      through_message_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      character TEXT NOT NULL,
      user_message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      assistant_message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done')),
      attempts INTEGER NOT NULL DEFAULT 0,
      facts_done INTEGER NOT NULL DEFAULT 0,
      vectors_done INTEGER NOT NULL DEFAULT 0,
      summary_done INTEGER NOT NULL DEFAULT 0,
      legacy_done INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS memory_jobs_pending ON memory_jobs(status, next_attempt_at, id);

    CREATE TABLE IF NOT EXISTS memory_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_topic_sources (
      topic_id INTEGER NOT NULL REFERENCES memory_topics(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      PRIMARY KEY (topic_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS memory_core (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_core_sources (
      core_id INTEGER NOT NULL REFERENCES memory_core(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      PRIMARY KEY (core_id, message_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_topic_search USING fts5(terms, tokenize='unicode61');

    CREATE TABLE IF NOT EXISTS companion_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      frequency TEXT NOT NULL DEFAULT 'rare' CHECK (frequency IN ('rare','normal')),
      quiet_start TEXT NOT NULL DEFAULT '23:00',
      quiet_end TEXT NOT NULL DEFAULT '08:00',
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO companion_settings(id, enabled, frequency, quiet_start, quiet_end, updated_at)
      VALUES (1, 0, 'rare', '23:00', '08:00', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    CREATE TABLE IF NOT EXISTS relationship_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      affinity_points INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO relationship_state(id, affinity_points, updated_at)
      VALUES (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    CREATE TABLE IF NOT EXISTS relationship_events (
      assistant_message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      user_message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      character TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS relationship_events_created_at ON relationship_events(created_at, character);
    CREATE TABLE IF NOT EXISTS character_moods (
      character TEXT PRIMARY KEY,
      emotion TEXT NOT NULL,
      intensity INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proactive_triggers (
      id TEXT PRIMARY KEY,
      source_message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      fact_id INTEGER NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      plan_text TEXT NOT NULL,
      evidence TEXT NOT NULL,
      due_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','sent','suppressed','expired','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      message_id INTEGER UNIQUE REFERENCES messages(id) ON DELETE SET NULL,
      content TEXT,
      last_error TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proactive_triggers_pending ON proactive_triggers(status, due_at, expires_at);
    CREATE INDEX IF NOT EXISTS proactive_triggers_sent ON proactive_triggers(status, sent_at DESC);

    CREATE TABLE IF NOT EXISTS memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      value TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('fact','preference','plan','relationship')),
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      status TEXT NOT NULL CHECK (status IN ('active','superseded')),
      vector_entry_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_facts_subject_predicate ON memory_facts(subject, predicate, status);
    CREATE INDEX IF NOT EXISTS memory_facts_validity ON memory_facts(valid_from, valid_to);
    CREATE TABLE IF NOT EXISTS memory_fact_sources (
      fact_id INTEGER NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      quote TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (fact_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS memory_fact_sources_message ON memory_fact_sources(message_id);

    CREATE TABLE IF NOT EXISTS memory_experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      url TEXT,
      source_id TEXT NOT NULL UNIQUE,
      source_session_id TEXT,
      source_message_id INTEGER,
      source_missing INTEGER NOT NULL DEFAULT 0,
      vector_indexed INTEGER NOT NULL DEFAULT 0,
      vector_entry_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_experience_sessions (
      experience_id INTEGER NOT NULL REFERENCES memory_experiences(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      PRIMARY KEY (experience_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS memory_experience_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experience_id INTEGER NOT NULL REFERENCES memory_experiences(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      occurred_at TEXT NOT NULL,
      UNIQUE (experience_id, session_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS memory_experience_occurrences_date ON memory_experience_occurrences(occurred_at, experience_id);
    CREATE INDEX IF NOT EXISTS memory_experience_occurrences_session ON memory_experience_occurrences(session_id, message_id);
    INSERT OR IGNORE INTO memory_experience_occurrences(experience_id, session_id, message_id, occurred_at)
      SELECT id, source_session_id, source_message_id, created_at FROM memory_experiences
      WHERE kind IN ('video','web') AND source_session_id IS NOT NULL AND source_message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS memory_experience_sessions_session ON memory_experience_sessions(session_id, experience_id);
    INSERT OR IGNORE INTO memory_experience_sessions(experience_id, session_id)
      SELECT id, source_session_id FROM memory_experiences WHERE source_session_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS memory_legacy_sources (
      vector_entry_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      PRIMARY KEY (vector_entry_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS memory_legacy_sources_session ON memory_legacy_sources(session_id, vector_entry_id);
    CREATE INDEX IF NOT EXISTS memory_experiences_kind_created_id ON memory_experiences(kind, created_at DESC, id DESC);
    DROP INDEX IF EXISTS memory_experiences_kind_created;
    CREATE INDEX IF NOT EXISTS memory_experiences_vector_pending ON memory_experiences(vector_indexed, next_attempt_at, id);

    CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(terms, tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS message_search_indexed (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS fact_search USING fts5(terms, tokenize='unicode61');
    CREATE VIRTUAL TABLE IF NOT EXISTS experience_search USING fts5(terms, tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS experience_search_indexed (
      experience_id INTEGER PRIMARY KEY REFERENCES memory_experiences(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS search_index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateExperiences(db);
  return db;
}

function migrateMessages(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(messages)").all() as unknown as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "character")) {
    db.exec("ALTER TABLE messages ADD COLUMN character TEXT NOT NULL DEFAULT 'whale'");
  }
  if (!columns.some((column) => column.name === "session_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN session_id TEXT");
  }
  // B6.3：随消息附带的材料（例如她逛到的明信片）；旧库自动补列。
  if (!columns.some((column) => column.name === "attachment_json")) {
    db.exec("ALTER TABLE messages ADD COLUMN attachment_json TEXT");
  }
}

function migrateSessions(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(chat_sessions)").all() as unknown as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "title_manual")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN title_manual INTEGER NOT NULL DEFAULT 0");
  }
}

function migrateExperiences(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(memory_experiences)").all() as unknown as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "source_missing")) {
    db.exec("ALTER TABLE memory_experiences ADD COLUMN source_missing INTEGER NOT NULL DEFAULT 0");
  }
}
