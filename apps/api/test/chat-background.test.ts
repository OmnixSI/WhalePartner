import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { loadConfig } from "../src/server/config.ts";
import { pauseBackgroundJobs, queueLearning, queueReflection, waitForBackgroundJobs } from "../src/chat/background.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import type { MemoryStore } from "../src/memory/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";

test("reflection reads recent learned material from the shared archive", async () => {
  await waitForBackgroundJobs();
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "学习记录");
  store.add("user", "我们聊到了鲸鱼的声音。", null, "whale", session.id);
  store.add("assistant", "我记下来了。", null, "whale", session.id);
  store.upsertExperience({
    kind: "learned", title: "新知识", text: "鲸鱼用声音进行远距离交流。",
    sourceId: "learned:video:BV1REFLECT:0", sourceSessionIds: [session.id],
  });
  let recentLearningReads = 0;
  const memory: MemoryStore = {
    async remember() { return []; },
    async recall() { return []; },
    async recentExperiences() { return []; },
    async recentLearnings() { recentLearningReads += 1; return []; },
    async addExperience(input) { return { id: "e", kind: "experience", text: input.text }; },
    async list() { return []; },
    async remove() {},
  };
  let prompt = "";
  const provider: ChatProvider = {
    id: "fake", model: "reflection-archive-test",
    async *stream(messages) {
      prompt = messages.at(-1)?.content ?? "";
      yield { text: "[emotion:neutral]我觉得这件事很有意思。" };
    },
  };

  try {
    queueReflection({ provider, store, memory }, "whale", true);
    await waitForBackgroundJobs();
    assert.match(prompt, /鲸鱼用声音进行远距离交流/);
    assert.equal(recentLearningReads, 0);
  } finally {
    store.close();
  }
});

test("session deletion waits for learning jobs that reference the session", async () => {
  await waitForBackgroundJobs();
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "读过的网页");
  store.add("user", "我把这篇网页发给你了", null, "whale", session.id);
  let start: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => { start = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const provider: ChatProvider = {
    id: "fake",
    model: "background-test",
    async *stream() {
      if (calls++ === 0) {
        start();
        await blocked;
        yield { text: '[{"kind":"knowledge","text":"潮汐会影响海岸的生态变化"}]' };
      } else {
        yield { text: "这段经历值得留个小记。" };
      }
    },
  };
  queueLearning({ provider, store }, "whale", { title: "海岸生态", text: "潮汐影响海岸生态。" }, "web:background-test", [session.id]);
  await started;

  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const deleting = fetch(`${base}/api/chat/sessions/${session.id}?character=whale`, { method: "DELETE" });
    const completedEarly = await Promise.race([deleting.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20))]);
    assert.equal(completedEarly, false);

    release();
    const response = await deleting;
    assert.equal(response.status, 200);
    assert.equal(store.getSession(session.id, "whale"), undefined);
    assert.equal(store.experienceBySourceId("learned:web:background-test:0")?.sourceSessionId, null);
    await waitForBackgroundJobs();
  } finally {
    release();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});

test("background learning queued during deletion skips a deleted source session", async () => {
  await waitForBackgroundJobs();
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "待删除的网页会话");
  store.add("user", "我分享了一篇网页", null, "whale", session.id);
  let calls = 0;
  const provider: ChatProvider = {
    id: "fake",
    model: "deferred-background-test",
    async *stream() {
      calls += 1;
      yield { text: '[{"kind":"knowledge","text":"潮汐会影响海岸的生态变化"}]' };
    },
  };
  const unlock = await pauseBackgroundJobs();
  try {
    queueLearning({ provider, store }, "whale", { title: "海岸生态", text: "潮汐影响海岸生态。" }, "web:deferred-test", [session.id]);
    assert.ok(store.deleteSession(session.id, "whale"));
  } finally {
    unlock();
  }
  await waitForBackgroundJobs();
  assert.equal(calls, 0);
  assert.equal(store.experienceBySourceId("learned:web:deferred-test:0"), undefined);
  store.close();
});

test("a deferred reflection cannot restore a note after chat history is cleared", async () => {
  await waitForBackgroundJobs();
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "即将清空的聊天");
  store.add("user", "我们刚聊完海洋。", null, "whale", session.id);
  store.add("assistant", "我会记下这段聊天。", null, "whale", session.id);
  store.setNote("whale", "这是一段旧近况。", 1);
  let calls = 0;
  const provider: ChatProvider = {
    id: "fake",
    model: "cleared-reflection-test",
    async *stream() {
      calls += 1;
      yield { text: "不应生成的旧近况。" };
    },
  };
  const unlock = await pauseBackgroundJobs();
  try {
    queueReflection({ provider, store }, "whale", true);
    store.clear();
  } finally {
    unlock();
  }
  await waitForBackgroundJobs();
  assert.equal(calls, 0);
  assert.equal(store.getNote("whale"), undefined);
  store.close();
});

test("clearing chat waits for active background work and clears history", async () => {
  await waitForBackgroundJobs();
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "即将清空的网页会话");
  store.add("user", "我分享了一篇海洋网页。", null, "whale", session.id);
  store.add("assistant", "我来读读看。", null, "whale", session.id);
  let start: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => { start = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const provider: ChatProvider = {
    id: "fake",
    model: "clear-history-queue-test",
    async *stream() {
      calls += 1;
      if (calls === 1) {
        start();
        await blocked;
      }
      yield { text: "[]" };
    },
  };
  queueLearning({ provider, store }, "whale", { title: "海洋网页", text: "一段海洋知识。" }, "web:clear-history", [session.id]);
  await started;
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const clearing = fetch(`${base}/api/chat/history`, { method: "DELETE" });
    const completedEarly = await Promise.race([clearing.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20))]);
    assert.equal(completedEarly, false);
    release();
    assert.equal((await clearing).status, 200);
    await waitForBackgroundJobs();
    assert.equal(calls, 1);
    assert.equal(store.getNote("whale"), undefined);
  } finally {
    release();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});

test("clearing chat waits for an active video read before deleting its source session", async () => {
  await waitForBackgroundJobs();
  const store = new ChatStore(":memory:");
  let start: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => { start = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const video = {
    async collect() {
      start();
      await blocked;
      return {
        bvid: "BV1Q541167Qg",
        title: "鲸鱼迁徙",
        uploader: "海洋频道",
        url: "https://www.bilibili.com/video/BV1Q541167Qg",
        durationSeconds: 60,
        hasTranscript: true,
        frameCount: 1,
        dispose: async () => {},
        prompt: "迁徙画面",
        framePaths: [],
      };
    },
    async summarize() {
      return {
        bvid: "BV1Q541167Qg",
        title: "鲸鱼迁徙",
        uploader: "海洋频道",
        url: "https://www.bilibili.com/video/BV1Q541167Qg",
        durationSeconds: 60,
        summary: "# 分享给你\n鲸鱼开始迁徙。\n# 来源与依据\n来自字幕。",
        hasTranscript: true,
        frameCount: 1,
      };
    },
  };
  const provider: ChatProvider = {
    id: "fake",
    model: "clear-history-active-video-test",
    async *stream() {
      yield { text: "我看完啦。" };
    },
  };
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store, video });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const chat = fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "https://www.bilibili.com/video/BV1Q541167Qg", character: "whale" }),
    }).then(async (response) => ({ status: response.status, body: await response.text() }));
    await started;
    const clearing = fetch(`${base}/api/chat/history`, { method: "DELETE" }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const completedEarly = await Promise.race([clearing.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20))]);
    assert.equal(completedEarly, false);

    release();
    assert.equal((await chat).status, 200);
    assert.equal((await clearing).status, 200);
    assert.equal(store.listSessions("whale").length, 0);
    const retainedExperience = store.experienceBySourceId("BV1Q541167Qg");
    assert.equal(retainedExperience?.sourceSessionId, null);
    assert.equal(retainedExperience?.sourceMessageId, null);
    assert.equal(retainedExperience?.sourceMissing, true);
  } finally {
    release();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});
