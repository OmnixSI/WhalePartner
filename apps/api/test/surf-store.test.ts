import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSettings } from "../src/surf/settings.ts";
import { SurfRepository } from "../src/surf/store.ts";
import { SurfService } from "../src/surf/service.ts";
import { fakeMemory, fakeProvider, makeStore, tempDb } from "./surf-fakes.ts";

const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z`;

test("设置：没有行时给默认值，写进去再读回来一致", () => {
  const { store } = makeStore();
  const defaults = store.getSettings("whale");
  assert.deepEqual(defaults, defaultSettings("whale"));
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.frequency, "normal");
  assert.deepEqual(defaults.quiet, { start: "23:00", end: "08:00" });

  const saved = store.putSettings("whale", { frequency: "often", interests: ["鲸歌"], blocked: ["广告"], shareToChat: false }, at(1));
  assert.equal(saved.frequency, "often");
  assert.deepEqual(saved.interests, ["鲸歌"]);
  assert.deepEqual(saved.blocked, ["广告"]);
  assert.equal(saved.shareToChat, false);
  assert.equal(store.getSettings("whale").frequency, "often");
  // 局部更新不动其它字段
  store.putSettings("whale", { quiet: { start: "22:30" } }, at(2));
  const again = store.getSettings("whale");
  assert.deepEqual(again.quiet, { start: "22:30", end: "08:00" });
  assert.deepEqual(again.interests, ["鲸歌"]);
  store.close();
});

test("条目：同角色同去重键只收一条", () => {
  const { store } = makeStore();
  const { session } = store.startSession("whale", "2026-11-07 09:30", at(7));
  const input = {
    character: "whale",
    sessionId: session.id,
    kind: "video" as const,
    title: "深海",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    sourceSite: "bilibili",
    summary: "摘要",
    comment: "感想",
    tags: ["海洋"],
    score: 4,
    dedupeKey: "bv:BV1xx411c7mD",
    createdAt: at(7),
  };
  assert.ok(store.insertItem(input));
  assert.equal(store.insertItem(input), undefined, "第二次插同一个去重键应该被 UNIQUE 挡住");
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 20 }).total, 1);
  store.close();
});

test("feed：分页、按类型筛、按关键词搜、隐藏的不出现", () => {
  const { store } = makeStore();
  const { session } = store.startSession("whale", "2026-11-07 09:30", at(7));
  for (let i = 0; i < 5; i += 1) {
    store.insertItem({
      character: "whale",
      sessionId: session.id,
      kind: i % 2 === 0 ? "video" : "web",
      title: `第 ${i} 条`,
      url: `https://example.com/${i}`,
      sourceSite: i % 2 === 0 ? "bilibili" : "example.com",
      summary: i === 3 ? "这一条里有鲸歌两个字" : "普通摘要",
      comment: "感想",
      tags: i === 2 ? ["手帐"] : [],
      score: 3,
      dedupeKey: `k-${i}`,
      createdAt: `2026-11-07T08:0${i}:00.000Z`,
    });
  }
  const page1 = store.feed({ character: "whale", page: 1, pageSize: 2 });
  assert.equal(page1.total, 5);
  assert.equal(page1.items.length, 2);
  assert.equal(page1.items[0].title, "第 4 条", "新的在前");

  assert.equal(store.feed({ character: "whale", kind: "web", page: 1, pageSize: 20 }).total, 2);
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 20, q: "鲸歌" }).total, 1);
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 20, q: "手帐" }).total, 1, "tags 也参与搜索");

  store.hideItem(page1.items[0].id);
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 20 }).total, 4);
  store.close();
});

test("忘掉：软删除条目，同时删掉记忆与缩略图文件", async () => {
  const { path } = tempDb("forget");
  const { dir } = tempDb("forget-dir");
  const store = new SurfRepository(path);
  const memory = fakeMemory();
  const { provider } = fakeProvider();
  const service = new SurfService({ store, provider, memory, dir });

  const { session } = store.startSession("whale", "2026-11-07 09:30", at(7));
  mkdirSync(join(dir, "thumbs"), { recursive: true });
  writeFileSync(join(dir, "thumbs", "1.jpg"), "fake");
  const item = store.insertItem({
    character: "whale",
    sessionId: session.id,
    kind: "web",
    title: "要忘掉的一条",
    url: "https://example.com/a",
    sourceSite: "example.com",
    summary: "摘要",
    comment: "感想",
    tags: [],
    score: 3,
    dedupeKey: "web:abc",
    createdAt: at(7),
    thumbPath: "thumbs/1.jpg",
  })!;
  store.setExperience(item.id, "exp-9");

  const removed = await service.forget(item.id);
  assert.equal(removed?.id, item.id);
  assert.equal(store.item(item.id)?.hidden, true);
  assert.deepEqual(memory.removed, ["exp-9"]);
  assert.equal(existsSync(join(dir, "thumbs", "1.jpg")), false);
  assert.equal(await service.forget(9999), undefined);
  store.close();
});

test("记账：usage_ledger 的列名与 P-B 一致，能按角色汇总", () => {
  const { store } = makeStore();
  store.addLedger("whale", "surf", 20, at(7));
  store.addLedger("whale", "surf", 3, at(7));
  store.addLedger("deepseek", "surf", 3, at(7));
  assert.equal(store.ledgerUnits("whale"), 23);
  assert.deepEqual(store.ledgerRows("whale").map((row) => row.units), [20, 3]);
  assert.equal(store.ledgerUnits("whale", "2026-11-08T00:00:00.000Z"), 0);
  store.close();
});

test("聊天痕迹：最近 14 天有消息才算活跃角色", () => {
  const { path } = tempDb("chat");
  // messages 由 ChatStore 建表，这里模拟同一文件里的聊天记录。
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT, character TEXT, created_at TEXT)");
  db.prepare("INSERT INTO messages (role, content, character, created_at) VALUES ('user', '在吗', 'whale', ?)").run(new Date().toISOString());
  db.close();

  const store = new SurfRepository(path);
  const since = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
  assert.equal(store.hasRecentChat("whale", since), true);
  assert.equal(store.hasRecentChat("claude", since), false);
  assert.deepEqual(store.recentUserMessages("whale", since), ["在吗"]);
  store.close();
});

test("统计：被忘掉的条目不计入「今天逛了几个地方」", () => {
  const { store } = makeStore();
  const { session } = store.startSession("whale", "2026-11-07 09:30", at(7));
  const ids: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const item = store.insertItem({
      character: "whale",
      sessionId: session.id,
      kind: "video",
      title: `第 ${i} 条`,
      url: `https://example.com/v${i}`,
      sourceSite: "bilibili",
      summary: "摘要",
      comment: "感想",
      tags: [],
      score: 3,
      dedupeKey: `v-${i}`,
      createdAt: "2026-11-07T09:00:00.000Z",
    });
    assert.ok(item);
    ids.push(item.id);
  }
  assert.equal(store.countSince("whale", "video", "2026-11-07T00:00:00.000Z"), 2);
  store.hideItem(ids[0]);
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 10 }).total, 1);
  assert.equal(
    store.countSince("whale", "video", "2026-11-07T00:00:00.000Z"),
    1,
    "数字要和列表一致：忘掉的那条不该再算进去",
  );
  store.close();
});
