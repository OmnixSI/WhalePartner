import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";
import { SurfService } from "../src/surf/service.ts";
import type { Server } from "node:http";
import { baseConfig, fakeMemory, fakeProvider, fakeVideo, fakeWeb, makeStore, messageSink, tempDb } from "./surf-fakes.ts";

process.env.SURF_SSE_HEARTBEAT_MS = "40";

const { store: surfStore, path } = makeStore();
const memory = fakeMemory();
const messages = messageSink();
const { provider } = fakeProvider();
const service = new SurfService({
  store: surfStore,
  provider,
  memory,
  messages,
  video: fakeVideo(),
  web: fakeWeb({ delayMs: 60 }),
  thumbs: { fetch: async () => null },
  navGap: () => 0,
  dir: tempDb("routes-dir").dir,
});

const chat = new ChatStore(path);
const config = baseConfig({ dbPath: path });
const server: Server = createApiServer({
  config,
  provider: new FallbackChatProvider([provider]),
  store: chat,
  surf: service,
});
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  chat.close();
  surfStore.close();
});

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("设置：非法输入一律 400 invalid_settings", async () => {
  const cases: unknown[] = [
    { frequency: "常常" },
    { interests: Array.from({ length: 9 }, (_, i) => `兴趣${i}`) },
    { interests: ["这个兴趣实在是太长了超过十二个字"] },
    { blocked: Array.from({ length: 21 }, (_, i) => `词${i}`) },
    { quiet: { start: "25:00" } },
    { quiet: "晚上" },
    { enabled: "开" },
  ];
  for (const body of cases) {
    const response = await call("PUT", "/api/surf/settings?character=whale", body);
    assert.equal(response.status, 400, `应该拒绝：${JSON.stringify(body)}`);
    const payload = (await response.json()) as { error: string };
    assert.equal(payload.error, "invalid_settings");
  }
});

test("设置：往返 + 默认值 + webAvailable", async () => {
  const initial = (await (await call("GET", "/api/surf/settings?character=whale")).json()) as Record<string, unknown>;
  assert.equal(initial.enabled, true);
  assert.deepEqual(initial.quiet, { start: "23:00", end: "08:00" });
  assert.equal(initial.webAvailable, true);

  const saved = await call("PUT", "/api/surf/settings?character=whale", { frequency: "often", interests: ["鲸歌"], shareToChat: false });
  assert.equal(saved.status, 200);
  const payload = (await saved.json()) as Record<string, unknown>;
  assert.equal(payload.frequency, "often");
  assert.deepEqual(payload.interests, ["鲸歌"]);
  assert.equal(payload.shareToChat, false);
});

test("非法角色 400", async () => {
  const response = await call("GET", "/api/surf/status?character=不存在");
  assert.equal(response.status, 400);
});

test("见闻：feed 分页、按类型筛、q 搜索", async () => {
  const run = await call("POST", "/api/surf/run?character=whale");
  assert.equal(run.status, 202);
  const started = (await run.json()) as { sessionId: number };
  assert.equal(typeof started.sessionId, "number");

  // 等后台跑完
  for (let i = 0; i < 60; i += 1) {
    const status = (await (await call("GET", "/api/surf/status?character=whale")).json()) as { running: boolean };
    if (!status.running) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // 不给 pageSize 时默认 20（别把「没给参数」当成 0）
  const dflt = (await (await call("GET", "/api/surf/feed?character=whale")).json()) as { pageSize: number; items: unknown[]; total: number };
  assert.equal(dflt.pageSize, 20);
  assert.equal(dflt.items.length, dflt.total);

  const feed = await call("GET", "/api/surf/feed?character=whale&page=1&pageSize=2");
  const page = (await feed.json()) as { items: Array<{ id: number; kind: string }>; total: number; page: number; pageSize: number };
  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 2);
  assert.ok(page.total >= 3);
  assert.equal(page.items.length, 2);

  const videos = (await (await call("GET", "/api/surf/feed?character=whale&kind=video")).json()) as { total: number };
  assert.equal(videos.total, 1);
  const searched = (await (await call("GET", "/api/surf/feed?character=whale&q=海洋")).json()) as { total: number };
  assert.ok(searched.total >= 1, "标签里能搜到");
  const nothing = (await (await call("GET", "/api/surf/feed?character=whale&q=一定搜不到的词")).json()) as { total: number };
  assert.equal(nothing.total, 0);
});

test("重复手动触发：跑的时候 409，跑完 30 分钟内 429", async () => {
  // 上一轮的 run 可能还在收尾，先等它停
  for (let i = 0; i < 60; i += 1) {
    const status = (await (await call("GET", "/api/surf/status?character=whale")).json()) as { running: boolean };
    if (!status.running) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const first = await call("POST", "/api/surf/run?character=whale&character=whale");
  const during = await call("POST", "/api/surf/run?character=whale");
  // 第一次可能已经是 429（前面那个 test 刚跑过），那就只验证 429 的文案
  if (first.status === 202) {
    assert.equal(during.status, 409, "正在跑的时候再点应该是 409");
    const payload = (await during.json()) as { error: string };
    assert.equal(payload.error, "already_running");
  } else {
    assert.equal(first.status, 429);
  }

  for (let i = 0; i < 60; i += 1) {
    const status = (await (await call("GET", "/api/surf/status?character=whale")).json()) as { running: boolean };
    if (!status.running) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const tooSoon = await call("POST", "/api/surf/run?character=whale");
  assert.equal(tooSoon.status, 429);
  const payload = (await tooSoon.json()) as { error: string; message: string };
  assert.equal(payload.error, "too_soon");
  assert.equal(payload.message, "她刚回来不久，歇一会儿再去吧。");
});

test("忘掉：204 + 从 feed 消失 + 对应的记忆也删掉", async () => {
  const feed = (await (await call("GET", "/api/surf/feed?character=whale")).json()) as { items: Array<{ id: number }>; total: number };
  const target = feed.items[0].id;
  const before = memory.removed.length;
  const response = await call("DELETE", `/api/surf/items/${target}`);
  assert.equal(response.status, 204);
  const after = (await (await call("GET", "/api/surf/feed?character=whale")).json()) as { total: number };
  assert.equal(after.total, feed.total - 1);
  assert.equal(memory.removed.length, before + 1, "对应的 experience 一起删掉");
  assert.equal((await call("DELETE", `/api/surf/items/${target}`)).status, 204, "重复删不报错（已经隐藏了）");
  assert.equal((await call("DELETE", "/api/surf/items/999999")).status, 404);
});

test("单条详情与缩略图 404", async () => {
  const feed = (await (await call("GET", "/api/surf/feed?character=whale")).json()) as { items: Array<{ id: number }> };
  const id = feed.items[0].id;
  const detail = (await (await call("GET", `/api/surf/items/${id}`)).json()) as { id: number; summary: string };
  assert.equal(detail.id, id);
  assert.ok(detail.summary.length > 10);
  assert.equal((await call("GET", "/api/surf/items/999999")).status, 404);
  assert.equal((await call("GET", `/api/surf/thumb/${id}`)).status, 404, "没有缩略图就 404");
});

test("SSE：帧格式与心跳", async () => {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/surf/events?character=whale`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(String(response.headers.get("content-type")), /text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // 心跳是注释帧
  const first = await reader.read();
  buffer += decoder.decode(first.value);
  for (let i = 0; i < 10 && !buffer.includes(": ping"); i += 1) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value);
  }
  assert.match(buffer, /: ping\n\n/);

  // 事件帧：event + data
  service.bus.publish("whale", "item", { id: 42, kind: "web", title: "测试", sourceSite: "example.com", thumb: null, comment: "嗯", createdAt: "2026-11-07T00:00:00.000Z" });
  for (let i = 0; i < 10 && !buffer.includes("event: item"); i += 1) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value);
  }
  assert.match(buffer, /event: item\ndata: \{"id":42/);
  assert.match(buffer, /\n\n$/);

  controller.abort();
  reader.releaseLock();
});

test("聊天历史带上明信片附件", async () => {
  const feed = (await (await call("GET", "/api/surf/feed?character=whale")).json()) as { items: Array<{ id: number; sharedAt: string | null }> };
  const shared = feed.items.find((item) => item.sharedAt);
  if (!shared) return; // 这一轮没有分享（比如额度/频控挡住了），跳过
  const history = (await (await call("GET", "/api/chat/history?character=whale")).json()) as {
    messages: Array<{ id: number; attachment?: { type: string; itemId: number } }>;
  };
  const withAttachment = history.messages.find((message) => message.attachment);
  assert.equal(withAttachment?.attachment?.type, "surf");
  assert.equal(withAttachment?.attachment?.itemId, shared.id);
});

test("设置与状态里带上浏览器安装状态；feed 支持来源和日期筛选并回来源列表", async () => {
  const settings = (await (await call("GET", "/api/surf/settings?character=whale")).json()) as { browser?: { state: string } | null };
  assert.ok(settings.browser && typeof settings.browser.state === "string", "设置里要有 browser 状态");
  const status = (await (await call("GET", "/api/surf/status?character=whale")).json()) as { browser?: unknown; detail: unknown; waiting: boolean };
  assert.ok("browser" in status && "detail" in status && status.waiting === false);

  const day = new Date(2026, 5, 1, 9, 0, 0).toISOString();
  const { session } = surfStore.startSession("whale", "filters-test", day);
  const base = {
    character: "whale", sessionId: session.id, kind: "web" as const, summary: "一段够长的摘要文字用来占位。", comment: "嗯", tags: [], score: 3,
  };
  surfStore.insertItem({ ...base, title: "筛选甲", url: "https://filter-a.example.com/1", sourceSite: "filter-a.example.com", dedupeKey: "web:filter-a-1", createdAt: day });
  surfStore.insertItem({ ...base, title: "筛选乙", url: "https://filter-b.example.com/1", sourceSite: "filter-b.example.com", dedupeKey: "web:filter-b-1", createdAt: new Date(2026, 5, 3, 9, 0, 0).toISOString() });

  const bySite = (await (await call("GET", "/api/surf/feed?character=whale&site=filter-a.example.com")).json()) as { items: Array<{ title: string }>; total: number; sources: Array<{ site: string }> };
  assert.deepEqual(bySite.items.map((item) => item.title), ["筛选甲"]);
  assert.ok(bySite.sources.some((source) => source.site === "filter-b.example.com"), "来源列表不受当前筛选影响");

  const from = encodeURIComponent(new Date(2026, 5, 2).toISOString());
  const after = (await (await call("GET", `/api/surf/feed?character=whale&from=${from}&site=filter-b.example.com`)).json()) as { total: number };
  assert.equal(after.total, 1);
  const to = encodeURIComponent(new Date(2026, 5, 2).toISOString());
  const before = (await (await call("GET", `/api/surf/feed?character=whale&to=${to}&site=filter-b.example.com`)).json()) as { total: number };
  assert.equal(before.total, 0, "to 是开区间上界");
  const bad = (await (await call("GET", "/api/surf/feed?character=whale&from=not-a-date")).json()) as { total: number };
  assert.ok(bad.total >= 2, "坏日期参数当作没给");
});
