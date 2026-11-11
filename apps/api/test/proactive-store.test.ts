import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ChatStore } from "../src/store/index.ts";

const fixedNow = new Date("2026-06-18T12:00:00.000Z");

function enable(store: ChatStore) {
  store.putCompanionSettings({ enabled: true, quiet: { start: "00:00", end: "00:00" } });
}

function setupTrigger(store: ChatStore, now = fixedNow, text = "周五我会去看牙医。") {
  const session = store.createSession("whale");
  const user = store.add("user", text, null, "whale", session.id);
  const fact = store.saveFacts(user.id, [{
    subject: "用户",
    predicate: "计划",
    value: text,
    kind: "plan",
    evidence: text,
    confidence: 0.95,
    importance: 0.8,
    supersedes: false,
  }]).facts[0];
  assert.ok(fact);
  const triggerId = store.enqueueProactiveTrigger({
    sourceMessageId: user.id,
    factId: fact.id,
    sessionId: session.id,
    planText: `用户计划：${text}`,
    evidence: text,
  }, new Date(now.getTime() - 21 * 60_000));
  assert.ok(triggerId);
  return { triggerId, sourceMessageId: user.id, factId: fact.id, sessionId: session.id };
}

test("one source message can enqueue one trigger, and repeated reply text is suppressed", () => {
  const store = new ChatStore(":memory:");
  enable(store);
  const first = setupTrigger(store);
  const duplicate = store.enqueueProactiveTrigger({
    sourceMessageId: first.sourceMessageId,
    factId: first.factId,
    sessionId: first.sessionId,
    planText: "另一种摘要",
    evidence: "周五我会去看牙医。",
  });
  assert.equal(duplicate, first.triggerId);
  store.claimProactiveTrigger(first.triggerId, fixedNow);
  assert.equal(store.deliverProactiveMessage(first.triggerId, "记得周五要看牙医，最近还好吗？", "neutral", fixedNow)?.kind, "sent");

  const second = setupTrigger(store, new Date(fixedNow.getTime() + 19 * 60 * 60_000), "下周我会去复查牙齿。");
  store.claimProactiveTrigger(second.triggerId, new Date(fixedNow.getTime() + 20 * 60 * 60_000));
  const repeated = store.deliverProactiveMessage(second.triggerId, "记得周五要看牙医，最近还好吗？", "neutral", new Date(fixedNow.getTime() + 20 * 60 * 60_000));
  assert.equal(repeated?.kind, "duplicate");
  assert.equal(store.proactiveTrigger(second.triggerId)?.status, "suppressed");
  store.close();
});

test("restart restores future triggers and expires overdue messages", () => {
  const store = new ChatStore(":memory:");
  enable(store);
  const future = setupTrigger(store, new Date(fixedNow.getTime() + 60 * 60_000));
  const overdue = setupTrigger(store, fixedNow, "本周我会交课程作业。");
  store.claimProactiveTrigger(future.triggerId, new Date(fixedNow.getTime() + 60 * 60_000));
  store.claimProactiveTrigger(overdue.triggerId, fixedNow);

  store.recoverProactiveTriggers(fixedNow);

  assert.equal(store.proactiveTrigger(future.triggerId)?.status, "pending");
  assert.equal(store.proactiveTrigger(overdue.triggerId)?.status, "expired");
  assert.deepEqual(store.pendingProactiveTriggers(fixedNow).map((trigger) => trigger.id), [future.triggerId]);
  store.close();
});

test("opening an older chat database preserves its messages and adds companion settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp-proactive-migration-"));
  const path = join(dir, "app.db");
  const legacy = new DatabaseSync(path);
  legacy.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, emotion TEXT, character TEXT NOT NULL DEFAULT 'whale', created_at TEXT NOT NULL)");
  legacy.prepare("INSERT INTO messages(role, content, emotion, character, created_at) VALUES ('user', ?, NULL, 'whale', ?)").run("旧聊天内容", "2025-01-01T00:00:00.000Z");
  legacy.close();
  const store = new ChatStore(path);
  try {
    assert.equal(store.recent(10)[0].content, "旧聊天内容");
    assert.equal(store.companionSettings().enabled, false);
    assert.equal(store.recent(10)[0].attachment, null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
