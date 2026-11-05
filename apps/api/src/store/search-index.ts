import type { DatabaseSync } from "node:sqlite";
import { indexedMessageText } from "./search.ts";

const INDEX_VERSION = "2";

export function rebuildSearchIndexes(db: DatabaseSync) {
  const row = db.prepare("SELECT value FROM search_index_meta WHERE key = 'version'").get() as unknown as { value: string } | undefined;
  if (row?.value !== INDEX_VERSION) {
    db.exec(`
      DELETE FROM message_search;
      DELETE FROM message_search_indexed;
      DELETE FROM fact_search;
      DELETE FROM experience_search;
      DELETE FROM experience_search_indexed;
    `);
    db.prepare("INSERT INTO search_index_meta(key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(INDEX_VERSION);
  }
  indexMissingMessages(db);
  indexMissingFacts(db);
  indexMissingExperiences(db);
}

export function indexMessage(db: DatabaseSync, id: number, content: string) {
  withSavepoint(db, () => {
    db.prepare("DELETE FROM message_search WHERE rowid = ?").run(id);
    db.prepare("INSERT INTO message_search(rowid, terms) VALUES (?, ?)").run(id, indexedMessageText(content));
    db.prepare("INSERT OR REPLACE INTO message_search_indexed(message_id) VALUES (?)").run(id);
  });
}

export function indexFact(db: DatabaseSync, id: number, text: string) {
  db.prepare("INSERT OR REPLACE INTO fact_search(rowid, terms) VALUES (?, ?)").run(id, indexedMessageText(text));
}

export function indexExperience(db: DatabaseSync, id: number, text: string) {
  withSavepoint(db, () => {
    db.prepare("DELETE FROM experience_search WHERE rowid = ?").run(id);
    db.prepare("INSERT INTO experience_search(rowid, terms) VALUES (?, ?)").run(id, indexedMessageText(text));
    db.prepare("INSERT OR REPLACE INTO experience_search_indexed(experience_id) VALUES (?)").run(id);
  });
}

function indexMissingMessages(db: DatabaseSync) {
  withSavepoint(db, () => {
    const rows = db.prepare(`
      SELECT m.id, m.content FROM messages m
      LEFT JOIN message_search_indexed i ON i.message_id = m.id
      LEFT JOIN message_search s ON s.rowid = m.id
      WHERE i.message_id IS NULL OR s.rowid IS NULL
      ORDER BY m.id
    `).all() as unknown as Array<{ id: number; content: string }>;
    const removeSearch = db.prepare("DELETE FROM message_search WHERE rowid = ?");
    const insertSearch = db.prepare("INSERT INTO message_search(rowid, terms) VALUES (?, ?)");
    const mark = db.prepare("INSERT OR REPLACE INTO message_search_indexed(message_id) VALUES (?)");
    for (const row of rows) {
      removeSearch.run(row.id);
      insertSearch.run(row.id, indexedMessageText(row.content));
      mark.run(row.id);
    }
  });
}

function indexMissingFacts(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT id, subject, predicate, value FROM memory_facts
    WHERE id NOT IN (SELECT rowid FROM fact_search)
  `).all() as unknown as Array<{ id: number; subject: string; predicate: string; value: string }>;
  for (const row of rows) indexFact(db, row.id, `${row.subject} ${row.predicate} ${row.value}`);
}

function indexMissingExperiences(db: DatabaseSync) {
  withSavepoint(db, () => {
    const rows = db.prepare(`
      SELECT e.id, e.kind, e.title, e.text FROM memory_experiences e
      LEFT JOIN experience_search_indexed i ON i.experience_id = e.id
      LEFT JOIN experience_search s ON s.rowid = e.id
      WHERE i.experience_id IS NULL OR s.rowid IS NULL
      ORDER BY e.id
    `).all() as unknown as Array<{ id: number; kind: string; title: string; text: string }>;
    const removeSearch = db.prepare("DELETE FROM experience_search WHERE rowid = ?");
    const insertSearch = db.prepare("INSERT INTO experience_search(rowid, terms) VALUES (?, ?)");
    const mark = db.prepare("INSERT OR REPLACE INTO experience_search_indexed(experience_id) VALUES (?)");
    for (const row of rows) {
      removeSearch.run(row.id);
      insertSearch.run(row.id, indexedMessageText(`${row.kind} ${row.title} ${row.text}`));
      mark.run(row.id);
    }
  });
}

function withSavepoint(db: DatabaseSync, action: () => void) {
  db.exec("SAVEPOINT search_index_update");
  try {
    action();
    db.exec("RELEASE search_index_update");
  } catch (error) {
    db.exec("ROLLBACK TO search_index_update");
    db.exec("RELEASE search_index_update");
    throw error;
  }
}
