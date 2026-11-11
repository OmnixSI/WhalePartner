// SESSION_PATH 在 session.ts 加载时按 WP_DATA_DIR 算出来，所以先设环境变量再动态 import。
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "whalepartner-video-abort-"));
process.env.WP_DATA_DIR = dataDir;
await writeFile(join(dataDir, "bilibili-session.json"), JSON.stringify({ sessdata: "saved-session", savedAt: "2026-01-01T00:00:00Z" }));

const { runChat } = await import("../src/chat/service.ts");
const { FallbackChatProvider } = await import("../src/llm/router.ts");
const { ChatStore } = await import("../src/store/index.ts");
const { acquireVideoLock, createVideoService } = await import("../src/video/service.ts");

test("pressing stop while the saved Bilibili login is being verified rejects within a second and frees the video lock", async () => {
  const realFetch = globalThis.fetch;
  let navSignal: AbortSignal | undefined;
  // 登录态校验请求一直挂着，只在自己的 signal 被中止时才结束。
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    assert.match(String(input), /web-interface\/nav/);
    navSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      navSignal?.addEventListener("abort", () => reject(navSignal?.reason), { once: true });
    });
  }) as typeof fetch;

  const store = new ChatStore(":memory:");
  const controller = new AbortController();
  const provider = new FallbackChatProvider([{ id: "fake", model: "m", async *stream() { yield { text: "好" }; } }]);
  const events: string[] = [];
  const running = (async () => {
    for await (const event of runChat({ provider, store, video: createVideoService() }, "看看 BV1TESTTEST1", controller.signal)) events.push(event.type);
  })();
  const settled = running.then(() => "resolved", (error: unknown) => error);

  try {
    const deadline = Date.now() + 3_000;
    while (!navSignal) {
      if (Date.now() > deadline) throw new Error("没有走到登录态校验。");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const stoppedAt = Date.now();
    controller.abort();
    const outcome = await Promise.race([
      settled,
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 1_000)),
    ]);
    assert.notEqual(outcome, "still waiting", "按停 1 秒后登录态校验还在等");
    assert.notEqual(outcome, "resolved");
    assert.ok(Date.now() - stoppedAt < 1_000);
    // 视频锁已放开：能立刻再拿到。
    acquireVideoLock()();
  } finally {
    globalThis.fetch = realFetch;
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
