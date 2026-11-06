import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { DiaryStore } from "../src/diary-store.ts";
import { DiaryService } from "../src/diary-service.ts";
import { DEFAULT_DIARY_META, parseDiaryMeta } from "../src/diary-mood.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatMessage, ChatProvider } from "../src/llm/types.ts";
import type { MemoryEntry, MemoryStore } from "../src/memory/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";
import type { CollectedVideo, VideoService, VideoSummary } from "../src/video-service.ts";

const VIDEO: VideoSummary = {
  bvid: "BV1TESTTEST1",
  title: "鲸鱼的歌声",
  uploader: "海洋频道",
  url: "https://www.bilibili.com/video/BV1TESTTEST1",
  durationSeconds: 90,
  summary: "这支视频讲了鲸鱼如何用声音寻找同伴。",
  hasTranscript: true,
  frameCount: 4,
};

function fakeVideo(): VideoService {
  return {
    async collect(): Promise<CollectedVideo> {
      return { ...VIDEO, dispose: async () => {}, prompt: "", framePaths: [] };
    },
    async summarize(): Promise<VideoSummary> {
      return { ...VIDEO };
    },
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

interface MetaProviderOptions {
  meta?: () => string;
  failMeta?: boolean;
  failDiary?: boolean;
}

/** 夹具 provider：日记正文、说人话改写、心情 JSON 三类调用靠系统提示区分。 */
function metaProvider(options: MetaProviderOptions = {}) {
  const calls: ChatMessage[][] = [];
  const provider: ChatProvider = {
    id: "fake",
    model: "fake",
    async *stream(messages) {
      calls.push(messages);
      const system = messages[0]?.content ?? "";
      const user = messages.at(-1)?.content ?? "";
      if (system.includes("请只输出一个 JSON")) {
        if (options.failMeta) throw new Error("心情调用挂了");
        yield { text: options.meta ? options.meta() : '{"mood":"happy","weather":"sunny","title":"海边的声音"}' };
        return;
      }
      if (user.includes("<text>")) {
        const match = /<text>([\s\S]*)<\/text>/.exec(user);
        yield { text: match?.[1] ?? user };
        return;
      }
      if (options.failDiary) throw new Error("日记模型挂了");
      yield { text: "[emotion:happy]今天听鲸鱼的歌声，我想起声音也能把远处的生命连在一起。" };
    },
  };
  return { provider, calls };
}

function service(provider: ChatProvider, store = new DiaryStore(":memory:")) {
  return { store, diary: new DiaryService({ store, provider, video: fakeVideo(), memory: fakeMemory() }) };
}

test("a valid mood JSON lands on the diary item", async () => {
  const { provider } = metaProvider();
  const { store, diary } = service(provider);
  const item = diary.enqueue("BV1TESTTEST1").item;
  const done = await diary.runOnce();
  assert.equal(done?.id, item.id);
  assert.equal(done?.status, "done");
  const saved = store.get(item.id)!;
  assert.equal(saved.mood, "happy");
  assert.equal(saved.weather, "sunny");
  assert.equal(saved.diaryTitle, "海边的声音");
  store.close();
});

test("mood JSON wrapped in prose and code fences still parses", () => {
  assert.deepEqual(
    parseDiaryMeta('好的，我选好了：\n```json\n{"mood":"tired","weather":"rain","title":"雨声很好听"}\n```\n就这样。'),
    { mood: "tired", weather: "rain", title: "雨声很好听" },
  );
  assert.deepEqual(
    parseDiaryMeta('{"mood":"curious","weather":"snow","title":"' + "很".repeat(20) + '"}'),
    { mood: "curious", weather: "snow", title: "很".repeat(12) },
  );
});

test("invalid enums and non-JSON fall back to the defaults", () => {
  assert.deepEqual(parseDiaryMeta('{"mood":"angry","weather":"sunny","title":"x"}'), { ...DEFAULT_DIARY_META });
  assert.deepEqual(parseDiaryMeta('{"mood":"happy","weather":"storm"}'), { ...DEFAULT_DIARY_META });
  assert.deepEqual(parseDiaryMeta("今天很开心"), { ...DEFAULT_DIARY_META });
  assert.deepEqual(parseDiaryMeta(""), { ...DEFAULT_DIARY_META });
});

test("a failing second call still keeps the diary and writes the defaults", async () => {
  const { provider } = metaProvider({ failMeta: true });
  const { store, diary } = service(provider);
  const item = diary.enqueue("BV1TESTTEST1").item;
  const done = await diary.runOnce();
  assert.equal(done?.status, "done");
  assert.match(done?.diaryText ?? "", /鲸鱼的歌声/);
  const saved = store.get(item.id)!;
  assert.equal(saved.mood, "calm");
  assert.equal(saved.weather, "cloudy");
  assert.equal(saved.diaryTitle, null);
  store.close();
});

test("an old diary database gets the three columns added and old rows stay null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "whalepartner-diary-migrate-"));
  const path = join(dir, "app.db");
  try {
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE diary_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        input_url TEXT NOT NULL UNIQUE,
        bvid TEXT,
        title TEXT,
        source_url TEXT,
        summary TEXT,
        diary_text TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','processing','failed','done','duplicate')),
        error_stage TEXT CHECK (error_stage IN ('video','diary') OR error_stage IS NULL),
        error TEXT,
        memory_status TEXT CHECK (memory_status IN ('pending','saved','failed') OR memory_status IS NULL),
        memory_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        processed_at TEXT,
        duplicate_of INTEGER REFERENCES diary_items(id)
      );
    `);
    old.prepare("INSERT INTO diary_items (input_url, bvid, title, diary_text, status, processed_at) VALUES (?, ?, ?, ?, 'done', ?)")
      .run("BV1OLDOLDOLD", "BV1OLDOLDOLD", "旧视频", "旧日记正文。", "2026-01-01T00:00:00.000Z");
    old.close();

    const store = new DiaryStore(path);
    const [item] = store.list();
    assert.equal(item.diaryText, "旧日记正文。");
    assert.equal(item.mood, null);
    assert.equal(item.weather, null);
    assert.equal(item.diaryTitle, null);

    const chatStore = new ChatStore(":memory:");
    const server = createApiServer({
      config: loadConfig({}),
      provider: new FallbackChatProvider([metaProvider().provider]),
      store: chatStore,
      diary: new DiaryService({ store, provider: metaProvider().provider, video: fakeVideo(), memory: fakeMemory() }),
    });
    const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
    try {
      const body = (await (await fetch(`${base}/api/diary`)).json()) as { items: Array<{ mood: string | null; weather: string | null; diaryTitle: string | null }> };
      assert.equal(body.items[0].mood, null);
      assert.equal(body.items[0].weather, null);
      assert.equal(body.items[0].diaryTitle, null);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      chatStore.close();
      store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("startup backfill fills at most 30 missing moods and leaves the rest for later", async () => {
  const { provider, calls } = metaProvider();
  const { store, diary } = service(provider);
  for (let index = 1; index <= 40; index += 1) {
    const item = store.enqueue(`BV1TEST${String(index).padStart(5, "0")}`).item;
    store.saveDiary(item.id, `第 ${index} 天的日记。`);
  }
  const all = store.list(100);
  for (const item of all.slice(0, 5)) store.saveDiaryMeta(item.id, { mood: "cozy", weather: "wind", title: "旧标题" });
  assert.equal(store.listNeedingMood(100).length, 35);

  const filled = await diary.backfillMood({ intervalMs: 0 });
  assert.equal(filled, 30);
  assert.equal(calls.filter((messages) => (messages[0]?.content ?? "").includes("请只输出一个 JSON")).length, 30);
  assert.equal(store.listNeedingMood(100).length, 5);
  for (const item of all.slice(0, 5)) {
    const saved = store.get(item.id)!;
    assert.deepEqual([saved.mood, saved.weather, saved.diaryTitle], ["cozy", "wind", "旧标题"]);
  }
  store.close();
});
