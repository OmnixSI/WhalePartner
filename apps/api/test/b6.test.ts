import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { DiaryStore } from "../src/diary-store.ts";
import { DiaryService } from "../src/diary-service.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import type { MemoryEntry, MemoryStore } from "../src/memory/types.ts";
import { createApiServer, type ServerDeps } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";
import type { CollectedVideo, VideoService, VideoSummary } from "../src/video-service.ts";

const VIDEO: VideoSummary = {
  bvid: "BV1TESTTEST1", title: "鲸鱼的歌声", uploader: "海洋频道",
  url: "https://www.bilibili.com/video/BV1TESTTEST1", durationSeconds: 90,
  summary: "鲸鱼如何用声音寻找同伴。", hasTranscript: true, frameCount: 1,
};

function fakeProvider(): ChatProvider {
  return { id: "fake", model: "fake", async *stream() { yield { text: "好" }; } };
}

function fakeVideo(): VideoService {
  return {
    async collect(): Promise<CollectedVideo> { return { ...VIDEO, dispose: async () => {}, prompt: "", framePaths: [] }; },
    async summarize(): Promise<VideoSummary> { return { ...VIDEO }; },
  };
}

function fakeMemory(): MemoryStore {
  return {
    async remember() {},
    async recall() { return []; },
    async recentExperiences() { return []; },
    async recentLearnings() { return []; },
    async addExperience(): Promise<MemoryEntry> { return { id: "e", kind: "experience", text: "x" }; },
    async list() { return []; },
    async remove() {},
  };
}

async function withServer(deps: ServerDeps, run: (base: string) => Promise<void>) {
  const server = createApiServer(deps);
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    await run(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("GET /api/health turns DIARY_CRON into a readable journal time", async () => {
  const store = new ChatStore(":memory:");
  const provider = new FallbackChatProvider([fakeProvider()]);
  for (const [cron, expected] of [["30 20 * * *", "20:30"], ["0 20 * * *", "20:00"], ["5 9 * * 1", null], ["*/5 * * * *", null], ["99 99 * * *", null]] as const) {
    const diary = new DiaryService({ store: new DiaryStore(":memory:"), provider, video: fakeVideo(), memory: fakeMemory() });
    await withServer({ config: loadConfig({ DIARY_CRON: cron }), provider, store, diary }, async (base) => {
      const body = (await (await fetch(`${base}/api/health`)).json()) as { schedule?: { journalTime: string | null } };
      assert.deepEqual(body.schedule, { journalTime: expected }, cron);
    });
  }
  store.close();
});

test("health omits the schedule when no diary job is running", async () => {
  const store = new ChatStore(":memory:");
  await withServer({ config: loadConfig({}), provider: new FallbackChatProvider([fakeProvider()]), store }, async (base) => {
    const body = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
    assert.equal("schedule" in body, false);
  });
  store.close();
});

test("GET /api/chat/history returns the attachment object (B6.3)", async () => {
  const store = new ChatStore(":memory:");
  store.add("user", "看看这个视频");
  // 模拟 P5 落库的助手消息：直接带附件写入。
  const attachment = { kind: "video", bvid: "BV1TESTTEST1", title: "鲸鱼的歌声" };
  store.add("assistant", "我看完啦，鲸鱼会唱歌。", "happy", "whale", attachment);
  store.add("assistant", "这条没有附件。", null, "whale");
  await withServer({ config: loadConfig({}), provider: new FallbackChatProvider([fakeProvider()]), store }, async (base) => {
    const body = (await (await fetch(`${base}/api/chat/history?character=whale`)).json()) as { messages: Array<{ attachment: unknown; content: string }> };
    assert.deepEqual(body.messages.map((message) => message.attachment), [null, attachment, null]);
  });
  store.close();
});
