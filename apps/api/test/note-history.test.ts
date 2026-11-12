import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";

const idle: ChatProvider = { id: "fake", model: "m", async *stream() { yield { text: "好" }; } };

test("upgrading imports the existing note as the first history version, once", () => {
  const directory = mkdtempSync(join(tmpdir(), "whalepartner-note-"));
  const path = join(directory, "chat.db");
  const oldDb = new DatabaseSync(path);
  oldDb.exec(`
    CREATE TABLE character_notes (
      character TEXT PRIMARY KEY, text TEXT NOT NULL,
      assistant_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    INSERT INTO character_notes VALUES ('deepseek', '旧人格的小记', 12, '2026-11-06T13:43:43.966Z');
    INSERT INTO character_notes VALUES ('shared', '升级前的当前小记', 123, '2026-11-12T02:14:12.821Z');
  `);
  oldDb.close();
  try {
    let store = new ChatStore(path);
    assert.deepEqual(store.listNoteHistory().map((note) => [note.text, note.assistantCount, note.createdAt]), [
      ["升级前的当前小记", 123, "2026-11-12T02:14:12.821Z"],
      ["旧人格的小记", 12, "2026-11-06T13:43:43.966Z"],
    ]);
    store.close();
    // 再次打开不会重复导入。
    store = new ChatStore(path);
    assert.equal(store.listNoteHistory().length, 2);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed backfill rolls the history table back so the next open migrates again", () => {
  const directory = mkdtempSync(join(tmpdir(), "whalepartner-note-"));
  const path = join(directory, "chat.db");
  // 旧表的 text 允许空值，导入时撞上历史表的 NOT NULL，模拟回填中途失败。
  const oldDb = new DatabaseSync(path);
  oldDb.exec(`
    CREATE TABLE character_notes (
      character TEXT PRIMARY KEY, text TEXT,
      assistant_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    INSERT INTO character_notes VALUES ('deepseek', '旧人格的小记', 12, '2026-11-06T13:43:43.966Z');
    INSERT INTO character_notes VALUES ('shared', NULL, 123, '2026-11-12T02:14:12.821Z');
  `);
  oldDb.close();
  try {
    assert.throws(() => new ChatStore(path), /NOT NULL/);
    const check = new DatabaseSync(path);
    const table = check.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'character_note_history'").get();
    assert.equal(table, undefined, "回填失败时历史表应一起回滚");
    check.exec("UPDATE character_notes SET text = '升级前的当前小记' WHERE character = 'shared'");
    check.close();

    const store = new ChatStore(path);
    assert.deepEqual(store.listNoteHistory().map((note) => note.text), ["升级前的当前小记", "旧人格的小记"]);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setNote keeps one current note and appends every version to history", () => {
  const store = new ChatStore(":memory:");
  store.setNote("whale", "第一版近况", 12);
  store.setNote("deepseek", "第二版近况", 24);
  assert.equal(store.getNote("whale")?.text, "第二版近况");
  assert.equal(store.getNote("whale")?.assistantCount, 24);
  assert.deepEqual(store.listNoteHistory().map((note) => [note.text, note.assistantCount]), [["第二版近况", 24], ["第一版近况", 12]]);
  store.close();
});

test("deleting a session or clearing chat also clears note history", () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale");
  store.setNote("whale", "会被清掉的近况", 12);
  store.deleteSession(session.id, "whale");
  assert.equal(store.listNoteHistory().length, 0);
  store.setNote("whale", "又写了一版", 24);
  store.clear();
  assert.equal(store.listNoteHistory().length, 0);
  store.close();
});

test("/api/memories returns note versions and session observations as reflections, newest first", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "周末计划");
  store.setNote("whale", "第一版近况", 12);
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.saveObservation(session.id, "用户在想周末去海边。", 1, 2);
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.setNote("whale", "第二版近况", 24);
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([idle]), store, memory: undefined });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const body = (await (await fetch(`${base}/api/memories`)).json()) as {
      entries: Array<{ id: string; source?: string; text: string; title?: string; status?: string }>;
    };
    const reflections = body.entries.filter((entry) => entry.source === "reflection");
    assert.deepEqual(reflections.map((entry) => [entry.text, entry.status ?? null]), [
      ["第二版近况", "active"],
      ["用户在想周末去海边。", null],
      ["第一版近况", "superseded"],
    ]);
    assert.equal(reflections[0].title, "她现在的近况");
    assert.equal(reflections[1].title, "聊天观察 · 周末计划");
    assert.equal(reflections[1].id, `observation:${session.id}`);
  } finally {
    server.close();
    store.close();
  }
});
