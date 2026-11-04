import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { runChat, validateUserMessage, ChatInputError, type ChatEvent } from "../src/chat.ts";
import { loadConfig } from "../src/config.ts";
import { EmotionFilter } from "../src/emotion.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatMessage, ChatProvider } from "../src/llm/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

function scripted(chunks: string[], seen?: ChatMessage[][]): ChatProvider {
  return {
    id: "fake",
    model: "fake-model",
    async *stream(messages) {
      seen?.push(messages);
      for (const text of chunks) yield { text };
      yield { usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 3 } };
    },
  };
}

async function collect(events: AsyncIterable<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

test("emotion filter strips tags, even when a tag is split across chunks", () => {
  const filter = new EmotionFilter();
  const parts = ["[emo", "tion:ha", "ppy] 你好", "，我在[这里]", "[emotion:sad]", "呀 [emo"];
  const text: string[] = [];
  const emotions: string[] = [];
  for (const part of parts) {
    const result = filter.feed(part);
    text.push(result.text);
    emotions.push(...result.emotions);
  }
  text.push(filter.flush());
  assert.equal(text.join(""), " 你好，我在[这里]呀 [emo");
  assert.deepEqual(emotions, ["happy", "sad"]);
});

test("emotion filter drops unknown emotion names but keeps ordinary brackets", () => {
  const filter = new EmotionFilter();
  const result = filter.feed("[emotion:angry]好的[1]");
  assert.equal(result.text, "好的[1]");
  assert.deepEqual(result.emotions, []);
});

test("runChat stores both turns, emits emotion before text and reports provider and usage", async () => {
  const store = new ChatStore(":memory:");
  const seen: ChatMessage[][] = [];
  const provider = new FallbackChatProvider([scripted(["[emotion:happy]", " 早上好", "呀！"], seen)]);
  const events = await collect(runChat({ provider, store }, "早上好"));

  assert.deepEqual(events.map((e) => e.type), ["emotion", "delta", "delta", "done"]);
  const done = events.at(-1);
  assert.ok(done?.type === "done");
  assert.equal(done.emotion, "happy");
  assert.equal(done.provider, "fake");
  assert.deepEqual(done.usage, { inputTokens: 5, cachedInputTokens: 0, outputTokens: 3 });

  const saved = store.recent(10);
  assert.deepEqual(saved.map((m) => [m.role, m.content]), [["user", "早上好"], ["assistant", "早上好呀！"]]);
  assert.equal(saved[1].emotion, "happy");
  assert.equal(seen[0][0].role, "system");
  assert.ok(seen[0][0].content.includes("鲸汐"));
  assert.equal(seen[0].at(-1)?.content, "早上好");
});

test("runChat sends earlier turns as context", async () => {
  const store = new ChatStore(":memory:");
  store.add("user", "我叫阿宁");
  store.add("assistant", "记住啦");
  const seen: ChatMessage[][] = [];
  await collect(runChat({ provider: new FallbackChatProvider([scripted(["好"], seen)]), store }, "我是谁"));
  assert.deepEqual(seen[0].slice(1).map((m) => m.content), ["我叫阿宁", "记住啦", "我是谁"]);
});

test("runChat does not save a partial reply when the client aborts", async () => {
  const store = new ChatStore(":memory:");
  const abort = new AbortController();
  const provider: ChatProvider = {
    id: "slow",
    model: "m",
    async *stream() {
      yield { text: "半句" };
      abort.abort();
      yield { text: "话" };
    },
  };
  await assert.rejects(collect(runChat({ provider, store }, "喂", abort.signal)));
  assert.deepEqual(store.recent(10).map((m) => m.role), ["user"]);
});

test("runChat removes the user message when the model fails before any output", async () => {
  const store = new ChatStore(":memory:");
  const failing: ChatProvider = { id: "down", model: "m", async *stream() { throw new Error("挂了"); } };
  await assert.rejects(collect(runChat({ provider: failing, store }, "你好")), /挂了/);
  assert.equal(store.recent(10).length, 0);
});

test("validates user messages", () => {
  assert.equal(validateUserMessage("  你好  "), "你好");
  assert.throws(() => validateUserMessage("   "), ChatInputError);
  assert.throws(() => validateUserMessage(42), ChatInputError);
  assert.throws(() => validateUserMessage("字".repeat(2001)), /太长/);
});

test("POST /api/chat streams SSE events and history persists the turn", async () => {
  const store = new ChatStore(":memory:");
  const provider = new FallbackChatProvider([scripted(["[emotion:relaxed]你", "好"])]);
  const server = createApiServer({ config: loadConfig({}), provider, store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "嗨" }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const body = await res.text();
    assert.match(body, /event: emotion\ndata: {"emotion":"relaxed"}/);
    assert.match(body, /event: delta\ndata: {"text":"你"}/);
    assert.match(body, /event: done\ndata: {.*"emotion":"relaxed"/);

    const history = (await (await fetch(`${base}/api/chat/history`)).json()) as { messages: Array<{ role: string; content: string }> };
    assert.deepEqual(history.messages.map((m) => [m.role, m.content]), [["user", "嗨"], ["assistant", "你好"]]);

    const bad = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "" }) });
    assert.equal(bad.status, 400);
    const notJson = await fetch(`${base}/api/chat`, { method: "POST", body: "{oops" });
    assert.equal(notJson.status, 400);

    await fetch(`${base}/api/chat/history`, { method: "DELETE" });
    assert.equal(store.recent(5).length, 0);
  } finally {
    server.close();
  }
});

test("POST /api/chat reports provider failure as an SSE error event", async () => {
  const failing: ChatProvider = { id: "down", model: "m", async *stream() { throw new Error("上游挂了"); } };
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([failing]), store: new ChatStore(":memory:") });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "嗨" }) });
    assert.match(await res.text(), /event: error\ndata: {"message":".*上游挂了/);
  } finally {
    server.close();
  }
});
