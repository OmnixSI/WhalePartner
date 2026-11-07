import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BiliBackoff, backoffDelay, BACKOFF_BASE_MS, BACKOFF_MAX_MS } from "../src/surf/bili-backoff.ts";
import { createBilibiliVideoSource } from "../src/surf/bilibili-source.ts";
import { classifyError, SurfError, withRetry } from "../src/surf/errors.ts";
import type { SurfEventName } from "../src/surf/events.ts";
import { notifySurfItem } from "../src/surf/notify.ts";
import { hubEvents } from "../src/events.ts";
import { SurfScheduler } from "../src/surf/scheduler.ts";
import { MAX_ITEMS_PER_SESSION, SurfService } from "../src/surf/service.ts";
import { summaryPrompt } from "../src/surf/summary.ts";
import type { WebSource } from "../src/surf/types.ts";
import { fakeMemory, fakeProvider, fakeVideo, fakeWeb, makeStore, replyFor, seedChat, videoCandidate, webResult } from "./surf-fakes.ts";

const NOW = () => new Date(2026, 10, 7, 10, 0, 0);

function build(overrides: Partial<ConstructorParameters<typeof SurfService>[0]> = {}) {
  const { store, path } = makeStore();
  const events: Array<{ event: SurfEventName; data: unknown }> = [];
  const service = new SurfService({
    store,
    provider: fakeProvider().provider,
    memory: fakeMemory(),
    video: fakeVideo(),
    web: fakeWeb({ fixed: false }),
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    retryBaseMs: 0,
    chatPollMs: 5,
    now: NOW,
    ...overrides,
  });
  service.bus.subscribe("whale", (event, data) => events.push({ event, data }));
  return { store, path, service, events };
}

// ---- 聊天时暂停，聊完再继续 ----

test("逛到一半你开始聊天：她停下来等，聊完再继续，不丢已有进度", async () => {
  let chatting = false;
  let polls = 0;
  const gate = { started: false };
  const { store, service, events } = build({
    isUserChatting: () => {
      if (!gate.started) return false;
      // 用户在会话中途开始聊天，持续几个轮询周期后结束
      polls += 1;
      return polls <= 6;
    },
    video: fakeVideo({
      async search(keyword) {
        gate.started = true; // 搜完视频之后用户开口
        return [videoCandidate()];
      },
    }),
  });
  void chatting;
  const result = await service.run("whale", { manual: true });
  assert.equal(result.state, "done");
  assert.ok(result.items >= 1, "聊完之后继续逛，仍然带回了东西");
  const waits = events.filter((entry) => entry.event === "step" && (entry.data as { paused?: boolean }).paused);
  assert.ok(waits.length >= 1, "等待期间对外说明她在等");
  assert.match(String((waits[0].data as { detail: string }).detail), /聊天/);
  assert.ok(polls > 6, "确实轮询到聊完为止");
  store.close();
});

test("总时长只算真正在逛的时间：等你聊天的时间不占用额度", async () => {
  let chatting = false;
  const base = fakeWeb({ fixed: false, delayMs: 40 });
  const web: WebSource = {
    ...base,
    async search(keyword) {
      const results = await base.search(keyword);
      // 搜索回来之后你开口聊了 400ms，远超过 300ms 的总预算
      chatting = true;
      setTimeout(() => (chatting = false), 400);
      return results;
    },
  };
  const { store, service } = build({ timeoutMs: 300, video: undefined, web, isUserChatting: () => chatting });
  const result = await service.run("whale", { manual: true });
  assert.equal(result.state, "done", result.message ?? "");
  assert.ok(result.items >= 1);
  store.close();
});

test("开始之前你正在聊天：这趟不出门，也不占掉槽位（过会儿还能补上）", async () => {
  let chatting = true;
  const { store, path, service } = build({ isUserChatting: () => chatting });
  seedChat(path);
  const scheduler = new SurfScheduler({ service, characters: ["whale"], now: NOW });
  const at = new Date(2026, 10, 7, 9, 31, 0);
  const first = await scheduler.tick(at);
  assert.deepEqual(first.skipped, [{ character: "whale", reason: "chatting" }]);
  assert.equal(store.hasSession("whale", "2026-11-07 09:30"), false, "槽位没被吃掉");
  chatting = false;
  const later = await scheduler.tick(new Date(2026, 10, 7, 9, 40, 0));
  assert.deepEqual(later.started, ["whale"], "聊完后同一个槽位补上了");
  store.close();
});

// ---- 超时、关闭 ----

test("单次会话总时长有上限：超时就带着已完成的回来", async () => {
  const { store, service } = build({
    timeoutMs: 120,
    web: fakeWeb({ delayMs: 400, fixed: false }),
    video: undefined,
  });
  const started = Date.now();
  const result = await service.run("whale", { manual: true });
  assert.ok(Date.now() - started < 3000);
  assert.equal(result.state, "failed");
  assert.match(String(result.message), /逛太久/);
  store.close();
});

test("stop()：中止正在跑的会话并拒绝新的", async () => {
  const { store, service } = build({ web: fakeWeb({ delayMs: 2000, fixed: false }), video: undefined, timeoutMs: 60_000 });
  const running = service.run("whale", { manual: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(service.running, true);
  const started = Date.now();
  await service.stop();
  const result = await running;
  assert.ok(Date.now() - started < 1500, "不用等网页读完");
  assert.equal(result.state, "failed");
  assert.equal(service.running, false);
  const after = await service.run("whale", { manual: true });
  assert.equal(after.state, "skipped");
  store.close();
});

// ---- 质量：每次 1–3 条 ----

test("一次会话最多带回 3 条，并优先留想讲给你听的", async () => {
  const web: WebSource = {
    ...fakeWeb({ fixed: false }),
    async search() {
      return Array.from({ length: 6 }, (_, i) =>
        webResult({ url: `https://site${i}.example.com/a`, title: `鲸歌文章 ${i}`, snippet: "一段足够长的摘要文字，用来说明这篇文章讲了什么内容，超过四十个字符。" }),
      );
    },
  };
  const provider = fakeProvider((messages) => {
    const user = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
    if (user.includes("挑不超过")) return JSON.stringify({ picks: [0, 1, 2, 3].map((index) => ({ index })) });
    if (user.includes("worth_sharing")) {
      const n = Number(/鲸歌文章 (\d)/.exec(user)?.[1] ?? 0);
      return JSON.stringify({ summary: `这篇讲了鲸歌的第 ${n} 个侧面，写得很细，摘要长度足够。`, comment: "有点意思", tags: ["鲸歌"], worth_sharing: 1 + n, safe: true });
    }
    return replyFor(messages);
  }).provider;
  const { store, service } = build({ web, video: undefined, provider });
  store.putSettings("whale", { frequency: "often" }, NOW().toISOString());
  const result = await service.run("whale", { manual: true });
  assert.ok(result.items >= 1 && result.items <= MAX_ITEMS_PER_SESSION, `产出 ${result.items} 条`);
  assert.equal(MAX_ITEMS_PER_SESSION, 3);
  const scores = store.feed({ character: "whale", page: 1, pageSize: 10 }).items;
  assert.ok(scores.length <= 3);
  store.close();
});

test("总结提示词：事实与感受分开，评价用她自己的口吻", () => {
  const prompt = summaryPrompt({ kind: "web", title: "鲸歌", sourceSite: "example.com", text: "正文" });
  assert.match(prompt, /客观摘要/);
  assert.match(prompt, /不要出现“我”/);
  assert.match(prompt, /你自己的一句话评价/);
  assert.match(prompt, /平常说话的口吻/);
  assert.match(prompt, /不要复述摘要/);
});

// ---- 失败按类型处理 ----

test("错误分类与重试：只有网络类会重试，限流和内容问题不会", async () => {
  assert.equal(classifyError(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })), "network");
  assert.equal(classifyError(new Error("页面返回了 503。")), "network");
  assert.equal(classifyError(new Error("B 站触发 HTTP 412，本机已暂停视频请求")), "rate_limit");
  assert.equal(classifyError(new SurfError("rate_limit", "x", { status: 429 })), "rate_limit");
  assert.equal(classifyError(new Error("网页里没有读到足够的文字。")), "content");
  assert.equal(classifyError(new Error("browserType.launch: Executable doesn't exist")), "browser");

  let tries = 0;
  const waits: number[] = [];
  const value = await withRetry(
    async () => {
      tries += 1;
      if (tries < 3) throw new Error("fetch failed");
      return "ok";
    },
    { attempts: 3, baseMs: 100, sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(value, "ok");
  assert.deepEqual(waits, [100, 200], "指数退避");

  let limited = 0;
  await assert.rejects(() =>
    withRetry(async () => {
      limited += 1;
      throw new SurfError("rate_limit", "慢一点", { status: 429 });
    }, { attempts: 3, baseMs: 0 }),
  );
  assert.equal(limited, 1, "限流不重试");
});

test("纯网络原因整趟失败：槽位让出来，隔一会儿能再试，最多再试两次", async () => {
  const web: WebSource = { ...fakeWeb(), search: async () => { throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }); } };
  let clock = new Date(2026, 10, 7, 9, 31, 0);
  const { store, path, service } = build({ web, video: undefined, now: () => clock });
  seedChat(path);
  const scheduler = new SurfScheduler({ service, characters: ["whale"] });
  const at = (h: number, m: number) => (clock = new Date(2026, 10, 7, h, m, 0));
  await scheduler.tick(at(9, 31));
  assert.equal(store.hasSession("whale", "2026-11-07 09:30"), false, "失败的槽位被让出来");
  assert.equal(store.retriesForSlot("whale", "2026-11-07 09:30"), 1);
  assert.deepEqual((await scheduler.tick(at(9, 36))).started, [], "10 分钟内不重试");
  assert.deepEqual((await scheduler.tick(at(9, 45))).started, ["whale"], "隔了 10 分钟再试");
  assert.deepEqual((await scheduler.tick(at(9, 50))).started, [], "第二次重试后还要再等");
  assert.deepEqual((await scheduler.tick(at(10, 0))).started, ["whale"], "再隔 10 分钟，第三次（最后一次）");
  assert.equal(store.hasSession("whale", "2026-11-07 09:30"), true, "第三次失败后不再释放，这个槽位到此为止");
  assert.deepEqual((await scheduler.tick(at(10, 20))).started, []);
  store.close();
});

test("限流/浏览器问题不算「她坏了」，不触发 1 小时的全局退避", async () => {
  const web: WebSource = { ...fakeWeb(), search: async () => { throw new SurfError("rate_limit", "429", { status: 429 }); } };
  const { store, service } = build({ web, video: undefined });
  for (let i = 0; i < 4; i += 1) {
    const result = await service.run("whale", { slot: `2026-11-07 slot-${i}` });
    assert.notEqual(result.reason, "backoff");
  }
  store.close();
});

// ---- 无浏览器：降级 ----

test("无浏览器时的降级：视频照常带回来，网页如实报告并在后台开始安装", async () => {
  let prepared = 0;
  const web: WebSource = {
    ...fakeWeb({ available: false }),
    prepare: () => void (prepared += 1),
    browserStatus: () => ({ state: "installing", percent: 42, message: "正在下载浏览器" }),
  };
  const { store, service } = build({ web });
  const result = await service.run("whale", { manual: true });
  assert.equal(result.state, "done");
  assert.equal(result.items, 1, "只有视频");
  assert.equal(prepared, 1);
  const status = await service.status("whale");
  assert.equal(status.webAvailable, false);
  assert.deepEqual(status.browser, { state: "installing", percent: 42, message: "正在下载浏览器" });
  store.close();
});

// ---- B 站退避 ----

test("B 站指数退避：每次限流冷却翻倍、封顶、成功清零，状态写在数据目录", async () => {
  assert.equal(backoffDelay(1), BACKOFF_BASE_MS);
  assert.equal(backoffDelay(2), BACKOFF_BASE_MS * 2);
  assert.equal(backoffDelay(3), BACKOFF_BASE_MS * 4);
  assert.equal(backoffDelay(30), BACKOFF_MAX_MS);

  const dir = await mkdtemp(join(tmpdir(), "wp-backoff-"));
  const path = join(dir, "backoff.json");
  let clock = 1_000_000;
  const backoff = new BiliBackoff({ path: () => path, now: () => clock });
  await backoff.assertAllowed();
  const first = await backoff.recordFailure("412");
  assert.ok(first - clock >= BACKOFF_BASE_MS * 0.9 && first - clock <= BACKOFF_BASE_MS * 1.1);
  await assert.rejects(() => backoff.assertAllowed(), /再等/);
  clock = first + 1;
  await backoff.assertAllowed();
  const second = await backoff.recordFailure("412");
  assert.ok(second - clock >= BACKOFF_BASE_MS * 2 * 0.9, "第二次冷却翻倍");
  assert.equal(JSON.parse(await readFile(path, "utf8")).failures, 2);
  await backoff.recordSuccess();
  await backoff.assertAllowed();
  await rm(dir, { recursive: true, force: true });
});

test("B 站搜索被限流：记下退避，期间不再发请求", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wp-bili2-"));
  const previous = process.env.WP_DATA_DIR;
  process.env.WP_DATA_DIR = dir;
  try {
    let calls = 0;
    const backoff = new BiliBackoff({ path: () => join(dir, "b.json") });
    const source = createBilibiliVideoSource({
      backoff,
      fetchJson: async () => {
        calls += 1;
        throw new SurfError("rate_limit", "B 站返回了 412，被限流了。", { status: 412 });
      },
    });
    await assert.rejects(() => source.search("鲸歌"), /412/);
    const afterFirst = calls;
    await assert.rejects(() => source.search("鲸歌"), /再等/);
    assert.equal(calls, afterFirst, "冷却期内不发请求");
  } finally {
    if (previous === undefined) delete process.env.WP_DATA_DIR;
    else process.env.WP_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- 实时通知适配 ----

test("notify：新见闻会作为 surf.item 事件广播", async () => {
  const seen: string[] = [];
  const off = hubEvents.subscribe((event: { type: string }) => seen.push(event.type));
  const delivered = await notifySurfItem({
    id: 1, kind: "web", title: "t", url: "https://e.com", sourceSite: "e.com", thumb: null, thumbError: null, summary: "s", comment: "c", tags: [], createdAt: new Date().toISOString(), sharedAt: null,
  });
  assert.equal(delivered, true);
  off();
  assert.ok(seen.includes("surf.item"));
});
