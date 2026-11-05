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
  db.prepare("DELETE FROM message_search WHERE rowid = ?").run(id);
  db.prepare("INSERT INTO message_search(rowid, terms) VALUES (?, ?)").run(id, indexedMessageText(content));
  db.prepare("INSERT OR REPLACE INTO message_search_indexed(message_id) VALUES (?)").run(id);
}

export function indexFact(db: DatabaseSync, id: number, text: string) {
  db.prepare("INSERT OR REPLACE INTO fact_search(rowid, terms) VALUES (?, ?)").run(id, indexedMessageText(text));
}

export function indexExperience(db: DatabaseSync, id: number, text: string) {
  db.prepare("DELETE FROM experience_search WHERE rowid = ?").run(id);
  db.prepare("INSERT INTO experience_search(rowid, terms) VALUES (?, ?)").run(id, indexedMessageText(text));
  db.prepare("INSERT OR REPLACE INTO experience_search_indexed(experience_id) VALUES (?)").run(id);
}

function indexMissingMessages(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT id, content FROM messages
    WHERE id NOT IN (SELECT message_id FROM message_search_indexed)
    ORDER BY id
  `).all() as unknown as Array<{ id: number; content: string }>;
  const insertSearch = db.prepare("INSERT INTO message_search(rowid, terms) VALUES (?, ?)");
  const mark = db.prepare("INSERT INTO message_search_indexed(message_id) VALUES (?)");
  for (const row of rows) {
    insertSearch.run(row.id, indexedMessageText(row.content));
    mark.run(row.id);
  }
}

function indexMissingFacts(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT id, subject, predicate, value FROM memory_facts
    WHERE id NOT IN (SELECT rowid FROM fact_search)
  `).all() as unknown as Array<{ id: number; subject: string; predicate: string; value: string }>;
  for (const row of rows) indexFact(db, row.id, `${row.subject} ${row.predicate} ${row.value}`);
}

function indexMissingExperiences(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT e.id, e.kind, e.title, e.text FROM memory_experiences e
    WHERE e.id NOT IN (SELECT experience_id FROM experience_search_indexed)
    ORDER BY e.id
  `).all() as unknown as Array<{ id: number; kind: string; title: string; text: string }>;
  for (const row of rows) indexExperience(db, row.id, `${row.kind} ${row.title} ${row.text}`);
}
