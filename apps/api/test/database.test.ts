import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openChatDatabase } from "../src/store/database.ts";

test("database migration adds source status without replacing saved experiences", () => {
  const directory = mkdtempSync(join(tmpdir(), "whalepartner-db-"));
  const path = join(directory, "chat.db");
  const oldDb = new DatabaseSync(path);
  oldDb.exec(`
    CREATE TABLE memory_experiences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      url TEXT,
      source_id TEXT NOT NULL UNIQUE,
      source_session_id TEXT,
      source_message_id INTEGER,
      vector_indexed INTEGER NOT NULL DEFAULT 0,
      vector_entry_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX memory_experiences_kind_created ON memory_experiences(kind, created_at DESC);
    INSERT INTO memory_experiences(kind, title, text, source_id, created_at, updated_at)
    VALUES ('video', '海边的鲸', '保留的经历内容', 'video:existing', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  `);
  oldDb.close();

  const db = openChatDatabase(path);
  try {
    const columns = db.prepare("PRAGMA table_info(memory_experiences)").all() as unknown as Array<{ name: string }>;
    const indexes = db.prepare("PRAGMA index_list(memory_experiences)").all() as unknown as Array<{ name: string }>;
    const recentIndexColumns = db.prepare("PRAGMA index_info(memory_experiences_kind_created_id)").all() as unknown as Array<{ name: string }>;
    const experience = db.prepare("SELECT text, source_missing AS sourceMissing FROM memory_experiences WHERE source_id = 'video:existing'")
      .get() as unknown as { text: string; sourceMissing: number };
    assert.ok(columns.some((column) => column.name === "source_missing"));
    assert.ok(indexes.some((index) => index.name === "memory_experiences_kind_created_id"));
    assert.equal(indexes.some((index) => index.name === "memory_experiences_kind_created"), false);
    assert.deepEqual(recentIndexColumns.map((column) => column.name), ["kind", "created_at", "id"]);
    assert.equal(experience.text, "保留的经历内容");
    assert.equal(experience.sourceMissing, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
