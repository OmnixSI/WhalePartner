import assert from "node:assert/strict";
import { test } from "node:test";
import type { SurfEventName } from "../src/surf/events.ts";
import { SurfService } from "../src/surf/service.ts";
import type { SurfItem } from "../src/surf/types.ts";
import { fakeMemory, fakeProvider, fakeVideo, fakeWeb, makeStore, messageSink, replyFor, videoCandidate } from "./surf-fakes.ts";
import type { ChatMessage } from "../src/llm/types.ts";

/** 固定在一个不在安静时段的工作日上午，避免测试受运行时间影响。 */
const NOW = () => new Date(2026, 10, 7, 10, 0, 0);

function build(overrides: Partial<ConstructorParameters<typeof SurfService>[0]> = {}) {
  const { store } = makeStore();
  store.putSettings("whale", { interests: ["鲸歌"], blocked: [] }, NOW().toISOString());
  const { provider, calls } = fakeProvider();
  const memory = fakeMemory();
  const messages = messageSink();
  const events: Array<{ event: SurfEventName; data: unknown }> = [];
  const service = new SurfService({
    store,
    provider,
    memory,
    messages,
    video: fakeVideo(),
    web: fakeWeb(),
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    now: NOW,
    ...overrides,
  });
  service.bus.subscribe("whale", (event, data) => events.push({ event, data }));
  return { store, service, memory, messages, events, calls };
}

test("一次会话：1 个视频 + 2 个网页 → 3 条见闻、3 条记忆、26 贝壳、SSE 顺序", async () => {
  const { store, service, memory, messages, events } = build();
  const result = await service.run("whale", { manual: true });

  assert.equal(result.state, "done");
  assert.equal(result.items, 3);
  const feed = service.feed({ character: "whale", page: 1, pageSize: 20 });
  assert.equal(feed.total, 3);
  assert.deepEqual(feed.items.map((item) => item.kind).sort(), ["video", "web", "web"]);

  // 记忆：sourceId 全部以 surf: 开头，且 id 回写到条目上
  assert.equal(memory.added.length, 3);
  assert.ok(memory.added.every((input) => input.sourceId?.startsWith("surf:")));
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 20 }).items.filter((item) => item.sharedAt).length, 1);

  // 记账：20 + 3 + 3
  assert.equal(store.ledgerUnits("whale"), 26);
  assert.deepEqual(store.ledgerRows("whale").map((row) => [row.kind, row.units]), [["surf", 20], ["surf", 3], ["surf", 3]]);

  // SSE 顺序：先开会话，再 search/watch/read，整理后逐条冒出来，最后收尾
  const names = events.map((entry) => entry.event);
  assert.deepEqual(names, [
    "session", "step", "step", "step", "step", "item", "item", "item", "share", "session",
  ]);
  assert.deepEqual(events[0].data, { state: "start", sessionId: result.sessionId, kinds: ["video", "web"] });
  assert.deepEqual(
    events.filter((entry) => entry.event === "step").map((entry) => (entry.data as { stage: string }).stage),
    ["searching", "watching", "reading", "writing"],
  );
  assert.deepEqual(events.at(-1)?.data, { state: "end", sessionId: result.sessionId, kinds: ["video", "web"], count: 3 });

  // 分享：一条带附件的助手消息，附件指向那条见闻
  assert.equal(messages.added.length, 1);
  const message = messages.added[0];
  const attachment = service.attachmentOf(message.id);
  assert.equal(attachment?.type, "surf");
  const sharedId = Number((attachment as { itemId: number }).itemId);
  assert.equal(store.item(sharedId)?.hidden, false);
  assert.ok(store.item(sharedId)?.sharedMessageId === message.id);
  store.close();
});

test("分享频控：间隔不足 3 小时不再分享；当日第 3 次也不分享", async () => {
  const { store, service, messages } = build({ web: fakeWeb({ fixed: false }) });
  await service.run("whale", { manual: true });
  assert.equal(messages.added.length, 1);
  // 3 小时内再跑一次：条目照常进见闻页，但不打扰（换个槽位，避开手动冷却）
  const second = await service.run("whale", { slot: "2026-11-07 10:30" });
  assert.equal(second.state, "done");
  assert.equal(messages.added.length, 1, "间隔不足 3 小时不分享");

  // 把今天两条都标成已分享，模拟当日已经分享过 2 次
  for (const item of store.feed({ character: "whale", page: 1, pageSize: 20 }).items) {
    store.markShared(item.id, NOW().toISOString(), 900 + item.id);
  }
  const third = await service.run("whale", { slot: "2026-11-07 11:30" });
  assert.equal(third.state, "done");
  assert.ok(store.countSharedSince("whale", "2026-11-06T13:00:00.000Z") >= 3);
  assert.equal(messages.added.length, 1, "当日次数用完后不再分享");
  store.close();
});

test("静默时段：自动触发写 skipped(quiet)，不发 session 事件", async () => {
  const { store, service, events, memory } = build();
  store.putSettings("whale", { quiet: { start: "09:00", end: "11:00" } }, NOW().toISOString());
  const result = await service.run("whale", { manual: false });
  assert.equal(result.state, "skipped");
  assert.equal(result.reason, "quiet");
  assert.equal(events.length, 0, "跳过的会话不发 SSE");
  assert.equal(memory.added.length, 0);
  const last = store.lastSession("whale", ["skipped"]);
  assert.equal(last?.error, "quiet");
  store.close();
});

test("额度不足：整场不去逛", async () => {
  const quota = { isLow: () => true, canSpend: () => false };
  const { store, service } = build({ quota });
  const result = await service.run("whale", { manual: true });
  assert.equal(result.state, "skipped");
  assert.equal(result.reason, "quota");
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 20 }).total, 0);
  const status = await service.status("whale");
  assert.equal(status.pausedReason, "quota");
  store.close();
});

test("每日上限：当日名额用完就 skipped(daily_cap)", async () => {
  const { store, service } = build();
  const { session } = store.startSession("whale", "2026-11-07 08:00", NOW().toISOString());
  const at = "2026-11-07T00:30:00.000Z";
  for (let i = 0; i < 4; i += 1) {
    store.insertItem({
      character: "whale", sessionId: session.id, kind: "video", title: `视频 ${i}`, url: `https://b23.tv/${i}`,
      sourceSite: "bilibili", summary: "摘要", comment: "感想", tags: [], score: 3, dedupeKey: `v-${i}`, createdAt: at,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    store.insertItem({
      character: "whale", sessionId: session.id, kind: "web", title: `网页 ${i}`, url: `https://example.com/${i}`,
      sourceSite: "example.com", summary: "摘要", comment: "感想", tags: [], score: 3, dedupeKey: `w-${i}`, createdAt: at,
    });
  }
  const result = await service.run("whale", { manual: true });
  assert.equal(result.state, "skipped");
  assert.equal(result.reason, "daily_cap");
  store.close();
});

test("用户正在聊天时不打断", async () => {
  const { store, service } = build({ isUserChatting: () => true });
  const result = await service.run("whale", { manual: true });
  assert.equal(result.state, "skipped");
  assert.equal(result.reason, "chatting");
  store.close();
});

test("连续 3 次 provider 失败后进入 backoff", async () => {
  const broken = fakeProvider((messages: ChatMessage[]) => {
    const user = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
    if (user.includes("worth_sharing")) throw new Error("上游 500");
    return replyFor(messages);
  });
  const { store, service } = build({ provider: broken.provider });
  for (let i = 0; i < 3; i += 1) {
    const result = await service.run("whale", { slot: `2026-11-07 1${i}:00` });
    assert.equal(result.state, "failed", `第 ${i + 1} 次应该记成失败`);
    assert.equal(result.items, 0);
  }
  const blocked = await service.run("whale", { slot: "2026-11-07 14:00" });
  assert.equal(blocked.state, "skipped");
  assert.equal(blocked.reason, "backoff");
  store.close();
});

test("去重：同一个视频不会被逛第二回", async () => {
  const { store, service } = build({
    video: fakeVideo({ search: async () => [videoCandidate()] }),
    web: fakeWeb({ fixed: true }),
  });
  const first = await service.run("whale", { manual: true });
  assert.equal(first.items, 3);
  const before = service.feed({ character: "whale", page: 1, pageSize: 20 }).total;
  const second = await service.run("whale", { slot: "2026-11-07 10:30" });
  const after = service.feed({ character: "whale", page: 1, pageSize: 20 });
  assert.equal(after.total, before, "同一个视频、同一批网页都被去重挡掉");
  assert.equal(after.items.filter((item) => item.kind === "video").length, 1);
  assert.equal(second.items, 0);
  assert.equal(second.state, "failed", "没带回东西就如实记失败");
  assert.match(String(second.message), /没搜到合适的视频/);
  store.close();
});

test("安全过滤：总结里出现屏蔽词或 safe:false 的条目不入库", async () => {
  const unsafe = fakeProvider((messages: ChatMessage[]) => {
    const user = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
    if (user.includes("worth_sharing")) {
      return JSON.stringify({ summary: "这是一段很长的摘要，但内容不太合适。", comment: "赌博", tags: [], worth_sharing: 5, safe: true });
    }
    return replyFor(messages);
  });
  const { store, service } = build({ provider: unsafe.provider });
  const result = await service.run("whale", { manual: true });
  assert.equal(result.items, 0);
  assert.equal(result.state, "failed");
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 20 }).total, 0);
  store.close();
});

test("视频源搜不到合适内容时如实记失败原因", async () => {
  const emptyVideo = fakeVideo({
    async search() {
      return [videoCandidate({ durationSeconds: 10 })];
    },
  });
  const { store, service } = build({ video: emptyVideo });
  const result = await service.run("whale", { manual: true });
  assert.equal(result.state, "done", "网页部分成功，整场仍算逛成了");
  assert.equal(result.items, 2);
  const session = store.session(result.sessionId!);
  assert.match(String(session?.error), /没搜到合适的视频/);
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 20 }).items.every((item) => item.kind === "web"), true);
  store.close();
});

test("状态：今日条数、下一次时间、运行中的阶段", async () => {
  const { store, service } = build();
  const idle = await service.status("whale");
  assert.equal(idle.running, false);
  assert.equal(idle.todayCount, 0);
  assert.equal(idle.webAvailable, true);
  assert.equal(idle.nextRunAt, null === idle.nextRunAt ? null : idle.nextRunAt);
  assert.match(String(idle.nextRunAt), /^2026-11-07T/);

  await service.run("whale", { manual: true });
  const after = await service.status("whale");
  assert.equal(after.todayCount, 3);
  assert.equal(after.pausedReason, null);
  assert.equal(typeof after.lastRunAt, "string");
  store.close();
});

test("条目形状：feed 给的是接口路径，item 详情带全文", async () => {
  const { store, service } = build();
  await service.run("whale", { manual: true });
  const feed = service.feed({ character: "whale", page: 1, pageSize: 20 });
  const item: SurfItem = store.item(feed.items[0].id)!;
  assert.equal(typeof item.summary, "string");
  assert.equal(feed.items[0].thumb, null);
  assert.equal(service.item(999999), undefined);
  store.close();
});
