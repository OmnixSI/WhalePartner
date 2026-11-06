import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { ChatStore } from "../src/store.ts";
import { DiaryStore, type DiaryItem } from "../src/diary-store.ts";
import { DiaryService, type DiaryServiceDeps } from "../src/diary-service.ts";
import { startDiaryScheduler } from "../src/diary-scheduler.ts";
import { acquireVideoLock, type CollectedVideo, type VideoService, type VideoSummary } from "../src/video-service.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatMessage, ChatProvider, LlmDelta } from "../src/llm/types.ts";
import { waitForMemoryJobs } from "../src/memory/jobs.ts";
import type { ExperienceInput, MemoryEntry, MemoryStore } from "../src/memory/types.ts";
import { loadConfig } from "../src/config.ts";
import { createApiServer } from "../src/server.ts";
import { runChat } from "../src/chat.ts";

const SUMMARY = "# 分享给你\n\n这支视频讲了鲸鱼如何用声音寻找同伴。\n\n# 来源与依据\n\n字幕完整，画面抽样有限。";
const VIDEO: VideoSummary = {
  bvid: "BV1TESTTEST1", title: "鲸鱼的歌声", uploader: "海洋频道",
  url: "https://www.bilibili.com/video/BV1TESTTEST1", durationSeconds: 90,
  summary: SUMMARY, hasTranscript: true, frameCount: 4,
};

function fakeVideo(options: { failSummary?: () => boolean } = {}) {
  const calls = { collect: 0, summarize: 0, disposed: 0 };
  const service: VideoService = {
    async collect(input) {
      calls.collect++;
      const collected: CollectedVideo = {
        ...VIDEO,
        dispose: async () => { calls.disposed++; },
        prompt: `video:${input}`,
        framePaths: [],
      };
      return collected;
    },
    async summarize(collected) {
      calls.summarize++;
      await collected.dispose();
      if (options.failSummary?.()) throw new Error("摘要服务暂不可用。");
      return { ...VIDEO };
    },
  };
  return { service, calls };
}

function fakeProvider(options: { failDiary?: () => boolean; messages?: ChatMessage[][] } = {}): ChatProvider {
  return {
    id: "fake",
    model: "fake",
    async *stream(messages): AsyncIterable<LlmDelta> {
      options.messages?.push(messages);
      if (options.failDiary?.()) throw new Error("日记模型暂不可用。");
      yield { text: "[emotion:ha" };
      yield { text: "ppy]今天听鲸鱼的歌声，我想起声音也能把远处的生命连在一起。" };
    },
  };
}

function fakeMemory(options: { fail?: () => boolean } = {}) {
  const experiences: ExperienceInput[] = [];
  const memory: MemoryStore = {
    async recentLearnings() { return []; },
    async remember() {},
    async recall() { return []; },
    async recentExperiences() {
      return experiences.map((entry, index) => ({ id: String(index), kind: "experience", text: `${entry.title}\n${entry.text}`, source: entry.kind, title: entry.title, url: entry.url, sourceId: entry.sourceId }));
    },
    async addExperience(entry) {
      if (options.fail?.()) throw new Error("记忆暂不可用。");
      const previous = experiences.findIndex((item) => item.sourceId === entry.sourceId);
      if (previous >= 0) experiences.splice(previous, 1);
      experiences.push(entry);
      return { id: "experience", kind: "experience", text: `${entry.title}\n${entry.text}`, source: entry.kind, title: entry.title, url: entry.url, sourceId: entry.sourceId };
    },
    async list(): Promise<MemoryEntry[]> { return []; },
    async remove() {},
  };
  return { memory, experiences };
}

function service(deps: Partial<DiaryServiceDeps> & { store?: DiaryStore } = {}) {
  const store = deps.store ?? new DiaryStore(":memory:");
  const video = deps.video ?? fakeVideo().service;
  const provider = deps.provider ?? fakeProvider();
  return { store, diary: new DiaryService({ store, video, provider, memory: deps.memory }) };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2500) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error("等待定时日记任务超时。");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("normalizes equivalent Bilibili inputs and persists the queue across store restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "whalepartner-diary-store-"));
  const path = join(dir, "app.db");
  try {
    const first = new DiaryStore(path);
    const queued = first.enqueue("https://www.bilibili.com/video/BV1YJxP6KE65/?p=1");
    assert.equal(queued.created, true);
    assert.equal(queued.item.inputUrl, "BV1YJxP6KE65");
    first.markProcessing(queued.item.id);
    first.close();

    const restarted = new DiaryStore(path);
    assert.equal(restarted.list()[0].status, "pending");
    assert.equal(restarted.enqueue("BV1YJxP6KE65").created, false);
    restarted.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a scheduled run summarizes one queued video, writes a distinct diary memory, and retries do not duplicate it", async () => {
  const store = new DiaryStore(":memory:");
  const video = fakeVideo();
  const { memory, experiences } = fakeMemory();
  const { diary } = service({ store, video: video.service, memory });
  const queued = diary.enqueue("BV1TESTTEST1");

  const result = await diary.runOnce();
  assert.equal(result?.status, "done");
  assert.match(result?.diaryText ?? "", /听鲸鱼的歌声/);
  assert.equal(result?.diaryText?.includes("[emotion:"), false);
  assert.equal(result?.summary, SUMMARY);
  assert.equal(result?.memoryStatus, "saved");
  assert.equal(video.calls.summarize, 1);
  assert.deepEqual(experiences, [{
    kind: "diary", title: VIDEO.title, text: result?.diaryText,
    url: VIDEO.url, sourceId: "diary:BV1TESTTEST1",
  }]);
  assert.equal((await diary.runOnce()), null);
  assert.equal(video.calls.summarize, 1);
  assert.equal(store.findDiaryByBvid(VIDEO.bvid)?.id, queued.item.id);
  store.close();
});

test("a later chat with another character receives the diary as a recent experience", async () => {
  const store = new DiaryStore(":memory:");
  const video = fakeVideo();
  const { memory } = fakeMemory();
  const { diary } = service({ store, video: video.service, memory });
  await diary.enqueue("BV1TESTTEST1");
  await diary.runOnce();

  const seen: ChatMessage[][] = [];
  const chatStore = new ChatStore(":memory:");
  for await (const _event of runChat({
    provider: new FallbackChatProvider([fakeProvider({ messages: seen })]),
    store: chatStore,
    memory,
    video: video.service,
    character: "claude",
  }, "你最近看过什么视频？说一个细节")) { /* consume the reply */ }

  const chat = seen.find((messages) => messages[0]?.content.startsWith("# 角色设定：小克"));
  assert.ok(chat);
  const prompt = chat.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  assert.ok(prompt.includes("鲸鱼的歌声"));
  assert.ok(prompt.includes("声音也能把远处的生命连在一起"));
  assert.equal(video.calls.summarize, 1);
  await waitForMemoryJobs(chatStore);
  chatStore.close();
  store.close();
});

test("the cron callback triggers the same queue worker", async () => {
  const store = new DiaryStore(":memory:");
  const video = fakeVideo();
  const { diary } = service({ store, video: video.service, memory: fakeMemory().memory });
  diary.enqueue("BV1TESTTEST1");
  const stop = startDiaryScheduler("* * * * * *", diary);
  try {
    await waitFor(() => store.list()[0].status === "done");
    assert.equal(video.calls.summarize, 1);
  } finally {
    stop();
    await diary.waitForIdle();
    store.close();
  }
});

test("a diary model failure can be retried from the saved summary without rereading the video", async () => {
  const store = new DiaryStore(":memory:");
  const video = fakeVideo();
  let fail = true;
  const { diary } = service({ store, video: video.service, memory: fakeMemory().memory, provider: fakeProvider({ failDiary: () => fail }) });
  const item = diary.enqueue("BV1TESTTEST1").item;

  assert.equal((await diary.runOnce())?.status, "failed");
  assert.equal(store.get(item.id)?.errorStage, "diary");
  assert.equal(video.calls.summarize, 1);
  fail = false;
  diary.retry(item.id);
  assert.equal((await diary.runOnce())?.status, "done");
  assert.equal(video.calls.summarize, 1);
  store.close();
});

test("a failed memory write can be retried without repeating the video summary", async () => {
  const store = new DiaryStore(":memory:");
  const video = fakeVideo();
  let fail = true;
  const { memory, experiences } = fakeMemory({ fail: () => fail });
  const { diary } = service({ store, video: video.service, memory });
  const item = diary.enqueue("BV1TESTTEST1").item;

  assert.equal((await diary.runOnce())?.memoryStatus, "failed");
  assert.ok(store.get(item.id)?.diaryText);
  assert.equal(video.calls.summarize, 1);
  fail = false;
  diary.retry(item.id);
  assert.equal((await diary.runOnce())?.memoryStatus, "saved");
  assert.equal(video.calls.summarize, 1);
  assert.equal(experiences.length, 1);
  store.close();
});

test("a busy shared video lock leaves the item pending", async () => {
  const store = new DiaryStore(":memory:");
  const video = fakeVideo();
  const { diary } = service({ store, video: video.service, memory: fakeMemory().memory });
  diary.enqueue("BV1TESTTEST1");
  const release = acquireVideoLock();
  try {
    const result = await diary.runOnce();
    assert.equal(result?.status, "pending");
    assert.equal(video.calls.collect, 0);
  } finally {
    release();
    store.close();
  }
});

test("an already saved BV diary absorbs a duplicate short-link result", async () => {
  const store = new DiaryStore(":memory:");
  const video = fakeVideo();
  const { diary } = service({ store, video: video.service, memory: fakeMemory().memory });
  const first = diary.enqueue("BV1TESTTEST1").item;
  await diary.runOnce();

  const duplicate = store.enqueue("https://b23.tv/test").item;
  const result = await diary.runOnce();
  assert.equal(result?.id, duplicate.id);
  assert.equal(result?.status, "duplicate");
  assert.equal(result?.duplicateOf, first.id);
  assert.equal(store.list().filter((item) => item.diaryText).length, 1);
  assert.equal(video.calls.summarize, 1);
  store.close();
});

test("diary routes add, run, list, and retry queue items", async (t) => {
  const store = new DiaryStore(":memory:");
  const video = fakeVideo();
  const { memory } = fakeMemory();
  const { diary } = service({ store, video: video.service, memory });
  const chatStore = new ChatStore(":memory:");
  const server = createApiServer({
    config: loadConfig({ CODEX_FALLBACK: "1" }),
    provider: new FallbackChatProvider([fakeProvider()]),
    store: chatStore,
    diary,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await diary.waitForIdle();
    chatStore.close();
    store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "content-type": "application/json" };

  const invalid = await fetch(`${base}/api/diary/queue`, { method: "POST", headers, body: JSON.stringify({ url: "https://example.com/video" }) });
  assert.equal(invalid.status, 400);
  const added = await fetch(`${base}/api/diary/queue`, { method: "POST", headers, body: JSON.stringify({ url: "BV1TESTTEST1" }) });
  assert.equal(added.status, 201);
  const queued = (await added.json() as { item: DiaryItem }).item;
  const run = await fetch(`${base}/api/diary/run`, { method: "POST" });
  assert.equal(run.status, 202);
  await waitFor(() => store.get(queued.id)?.status === "done");
  const listed = await fetch(`${base}/api/diary`);
  assert.equal(((await listed.json()) as { items: DiaryItem[] }).items[0].diaryText?.includes("鲸鱼的歌声"), true);
});
