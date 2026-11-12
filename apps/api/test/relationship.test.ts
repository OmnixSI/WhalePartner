import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";
import { relationshipSnapshot } from "../src/relationship/policy.ts";

function recordTurn(store: ChatStore, character: string, at: Date, emotion: "neutral" | "happy" = "neutral") {
  const session = store.getOrCreateSession(character);
  const user = store.add("user", "今天聊聊", null, character, session.id);
  const assistant = store.add("assistant", "我在听。", emotion, character, session.id);
  const recorded = store.recordCompletedInteraction({ userMessageId: user.id, assistantMessageId: assistant.id, character, emotion }, at);
  return { assistant, recorded };
}

test("relationship awards completed DeepSeek turns once, enforces the daily cap, and unlocks five stages", () => {
  const store = new ChatStore(":memory:");
  try {
    const first = recordTurn(store, "deepseek", new Date("2026-10-01T12:00:00.000Z"), "happy");
    assert.equal(first.recorded, true);
    assert.equal(store.relationshipSnapshot("deepseek", new Date("2026-10-01T12:01:00.000Z")).mood.emotion, "happy");
    assert.equal(store.recordCompletedInteraction({
      userMessageId: store.recent(2, "deepseek")[1].id,
      assistantMessageId: first.assistant.id,
      character: "deepseek",
      emotion: "happy",
    }, new Date("2026-10-01T12:00:01.000Z")), false);

    for (let day = 0; day < 3; day += 1) {
      for (let turn = day === 0 ? 1 : 0; turn < 10; turn += 1) {
        recordTurn(store, "deepseek", new Date(Date.parse("2026-10-01T12:00:00.000Z") + day * 86_400_000 + turn * 1_000));
      }
    }
    recordTurn(store, "claude", new Date("2026-10-04T12:00:00.000Z"), "happy");

    const state = store.relationshipSnapshot("deepseek", new Date("2026-10-04T12:01:00.000Z"));
    assert.equal(state.points, 30);
    assert.equal(state.level, 2);
    assert.equal(state.label, "相熟");
    assert.equal(state.nextThreshold, 100);
    assert.equal(state.mood.emotion, "neutral");
    assert.equal(store.relationshipSnapshot("claude").points, 30);
    assert.equal(store.relationshipSnapshot("claude", new Date("2026-10-04T12:01:00.000Z")).mood.emotion, "happy");
    assert.equal(store.relationshipSnapshot("claude", new Date("2026-10-04T12:50:00.000Z")).mood.intensity, 50);
    assert.equal(store.relationshipSnapshot("claude", new Date("2026-10-04T13:40:00.000Z")).mood.emotion, "neutral");
    assert.equal(store.relationshipSnapshot("claude", new Date("2026-10-04T13:40:00.000Z")).level, 2);
    assert.equal(store.relationshipSnapshot("deepseek", new Date("2026-10-04T13:40:00.000Z")).points, 30);
  } finally {
    store.close();
  }
});

test("relationship tables upgrade an old chat database without losing messages and persist across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "whalepartner-relationship-"));
  const path = join(directory, "chat.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT,
        created_at TEXT NOT NULL DEFAULT '2026-10-01T12:00:00.000Z'
      );
      INSERT INTO messages(role, content, emotion) VALUES('user', '旧聊天内容', NULL);
      INSERT INTO messages(role, content, emotion) VALUES('assistant', '我记得。', 'neutral');
    `);
    legacy.close();

    let store = new ChatStore(path);
    assert.equal(store.recent(10, "whale").length, 2);
    assert.equal(store.relationshipSnapshot("deepseek").points, 0);
    recordTurn(store, "deepseek", new Date("2026-10-01T12:00:00.000Z"));
    store.close();

    store = new ChatStore(path);
    assert.equal(store.recent(10, "whale").length, 4);
    assert.equal(store.relationshipSnapshot("deepseek").points, 1);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("completed chats update the API once and invalid personas are rejected", async () => {
  const store = new ChatStore(":memory:");
  const provider: ChatProvider = { id: "fixture", model: "fixture", async *stream() { yield { text: "[emotion:happy]我在听。" }; } };
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const payload = { message: "今天聊聊", character: "deepseek", clientId: "relation-001" };
    const chat = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(chat.status, 200);
    assert.match(await chat.text(), /event: done/);

    const first = await fetch(`${base}/api/relationship?character=deepseek`);
    const firstState = await first.json() as { points: number; level: number; label: string; effect: string; nextThreshold: number; progress: number; mood: { emotion: string; intensity: number; updatedAt: string | null } };
    assert.equal(firstState.points, 1);
    assert.equal(firstState.level, 1);
    assert.equal(firstState.label, "相识");
    assert.equal(firstState.effect, "基础卡面");
    assert.equal(firstState.nextThreshold, 25);
    assert.equal(firstState.progress, 4);
    assert.equal(firstState.mood.emotion, "happy");
    assert.equal(firstState.mood.intensity, 100);
    assert.ok(firstState.mood.updatedAt);

    const duplicate = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(duplicate.status, 200);
    assert.match(await duplicate.text(), /"duplicate":true/);
    const afterDuplicate = await (await fetch(`${base}/api/relationship?character=deepseek`)).json() as { points: number };
    assert.equal(afterDuplicate.points, 1);
    assert.equal((await fetch(`${base}/api/relationship?character=not-a-character`)).status, 400);
  } finally {
    server.closeVoiceConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

const NEUTRAL = { emotion: "neutral", intensity: 0, updatedAt: null } as const;

test("every stage threshold is an exact boundary for level, label, nextThreshold and progress", () => {
  const cases: Array<[number, number, string, number | null, number]> = [
    // points, level, label, nextThreshold, progress(%)
    [0, 1, "相识", 25, 0],
    [24, 1, "相识", 25, 96],
    [25, 2, "相熟", 100, 0],
    [99, 2, "相熟", 100, 99],
    [100, 3, "默契", 250, 0],
    [249, 3, "默契", 250, 99],
    [250, 4, "亲近", 500, 0],
    [499, 4, "亲近", 500, 99],
    [500, 5, "相依", null, 100],
    [5000, 5, "相依", null, 100],
  ];
  for (const [points, level, label, nextThreshold, progress] of cases) {
    const state = relationshipSnapshot(points, NEUTRAL);
    assert.deepEqual(
      { points: state.points, level: state.level, label: state.label, nextThreshold: state.nextThreshold, progress: state.progress },
      { points, level, label, nextThreshold, progress },
      `points=${points}`,
    );
  }
  assert.equal(relationshipSnapshot(500, NEUTRAL).effect, "镀闪卡面");
  assert.equal(relationshipSnapshot(499, NEUTRAL).effect, "专属特效");
  assert.equal(relationshipSnapshot(-3, NEUTRAL).level, 1);
});

test("an existing database already past 500 points shows Lv5 after upgrade and keeps lower stages unchanged", () => {
  const directory = mkdtempSync(join(tmpdir(), "whalepartner-affinity5-"));
  const path = join(directory, "chat.sqlite");
  try {
    // 旧版（四档）写入的状态：好感度只是一个点数，阶段由点数算出，没有单独存档。
    const seed = new ChatStore(path);
    seed.close();
    const setPoints = (points: number) => {
      const raw = new DatabaseSync(path);
      raw.prepare("UPDATE relationship_state SET affinity_points = ? WHERE id = 1").run(points);
      raw.close();
    };
    const expectations: Array<[number, number, number | null]> = [
      [300, 4, 500], // 旧版封顶在 Lv4 的用户：仍是 Lv4，只是多了下一档
      [499, 4, 500],
      [500, 5, null],
      [1234, 5, null],
    ];
    for (const [points, level, nextThreshold] of expectations) {
      setPoints(points);
      const store = new ChatStore(path);
      try {
        const state = store.relationshipSnapshot("deepseek");
        assert.equal(state.points, points);
        assert.equal(state.level, level, `points=${points}`);
        assert.equal(state.nextThreshold, nextThreshold, `points=${points}`);
      } finally {
        store.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("GET /api/relationship at 500 points returns Lv5 with no next threshold", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whalepartner-affinity5-api-"));
  const path = join(directory, "chat.sqlite");
  const store = new ChatStore(path);
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE relationship_state SET affinity_points = 500 WHERE id = 1").run();
  raw.close();
  const provider: ChatProvider = { id: "fixture", model: "fixture", async *stream() { yield { text: "我在听。" }; } };
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const body = await (await fetch(`${base}/api/relationship?character=deepseek`)).json() as Record<string, unknown>;
    assert.equal(body.points, 500);
    assert.equal(body.level, 5);
    assert.equal(body.label, "相依");
    assert.equal(body.effect, "镀闪卡面");
    assert.equal(body.nextThreshold, null);
    assert.equal(body.progress, 100);
  } finally {
    server.closeVoiceConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deleting a chat does not reset the daily affinity cap", () => {
  const store = new ChatStore(":memory:");
  try {
    const day = new Date("2026-10-05T12:00:00.000Z");
    const session = store.getOrCreateSession("deepseek");
    for (let turn = 0; turn < 10; turn += 1) recordTurn(store, "deepseek", new Date(day.getTime() + turn * 1000));
    assert.equal(store.relationshipSnapshot("deepseek", day).points, 10);

    // 删掉当天聊满上限的会话：事件行级联删除，但按天记账保留，同一天不该再涨。
    assert.ok(store.deleteSession(session.id, "deepseek"));
    const after = recordTurn(store, "deepseek", new Date(day.getTime() + 60_000));
    assert.equal(after.recorded, true);
    assert.equal(store.relationshipSnapshot("deepseek", day).points, 10);

    // 第二天重新有 10 点。
    for (let turn = 0; turn < 10; turn += 1) recordTurn(store, "deepseek", new Date(day.getTime() + 86_400_000 + turn * 1000));
    assert.equal(store.relationshipSnapshot("deepseek", new Date(day.getTime() + 86_400_000)).points, 20);
  } finally {
    store.close();
  }
});

test("upgrading a database without daily_counters carries over today's affinity so deleting a chat still cannot reset the cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "wp-daily-counters-migration-"));
  const path = join(dir, "app.db");
  try {
    const before = new ChatStore(path);
    const start = Date.now();
    const session = before.getOrCreateSession("deepseek");
    for (let turn = 0; turn < 10; turn += 1) recordTurn(before, "deepseek", new Date(start + turn));
    before.close();

    // 还原成升级前的库：只有 relationship_events 里的记录，没有按天记账表。
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE daily_counters");
    legacy.close();

    const after = new ChatStore(path);
    try {
      assert.ok(after.deleteSession(session.id, "deepseek"));
      const next = recordTurn(after, "deepseek", new Date(start + 1000));
      assert.equal(next.recorded, true);
      assert.equal(after.relationshipSnapshot("deepseek", new Date(start + 1000)).points, 10);
    } finally {
      after.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
