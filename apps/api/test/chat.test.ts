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
  const result = filter.feed("[emotion:furious]好的[1]");
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

test("each character keeps its own history and gets its own persona", async () => {
  const store = new ChatStore(":memory:");
  const seen: ChatMessage[][] = [];
  const provider = new FallbackChatProvider([scripted(["[emotion:happy]好"], seen)]);
  await collect(runChat({ provider, store, character: "deepseek" }, "你好呀"));
  await collect(runChat({ provider, store, character: "claude" }, "早"));

  const chats = seen.filter((messages) => messages[0]?.content.startsWith("# 角色设定"));
  assert.equal(chats.length, 2);
  assert.ok(chats[0][0].content.startsWith("# 角色设定：大肥鱼"));
  assert.ok(chats[1][0].content.startsWith("# 角色设定：小克"));
  // 小克的上下文里看不到大肥鱼的对话。
  assert.deepEqual(chats[1].filter((message) => message.role !== "system").map((message) => message.content), ["早"]);
  assert.deepEqual(store.recent(10, "deepseek").map((m) => m.content), ["你好呀", "好"]);
  assert.deepEqual(store.recent(10, "claude").map((m) => m.content), ["早", "好"]);
  assert.deepEqual(store.recent(10, "whale"), []);
});

test("the chat routes validate the character and scope history by it", async () => {
  const store = new ChatStore(":memory:");
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([scripted(["好"])]), store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const post = (body: unknown) => fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ message: "嗨", character: "nope" })).status, 400);
    const ok = await post({ message: "嗨", character: "chatgpt" });
    assert.equal(ok.status, 200);
    await ok.text(); // 等回复流结束再查历史
    const mine = (await (await fetch(`${base}/api/chat/history?character=chatgpt`)).json()) as { messages: unknown[] };
    const other = (await (await fetch(`${base}/api/chat/history?character=claude`)).json()) as { messages: unknown[] };
    assert.equal(mine.messages.length, 2);
    assert.equal(other.messages.length, 0);
    assert.equal((await fetch(`${base}/api/chat/history?character=nope`)).status, 400);
  } finally {
    server.close();
  }
});

test("session rename persists and deletion removes only unshared session memories", async () => {
  const store = new ChatStore(":memory:");
  const first = store.createSession("chatgpt");
  const second = store.createSession("chatgpt");
  const user = store.add("user", "我最近喜欢看海洋纪录片", null, "chatgpt", first.id);
  store.add("assistant", "那我们一起看吧。", null, "chatgpt", first.id);
  const secondUser = store.add("user", "这是一段保留中的会话", null, "chatgpt", second.id);
  const { facts } = store.saveFacts(user.id, [{
    subject: "用户", predicate: "最近喜欢看", value: "海洋纪录片", kind: "preference",
    evidence: "我最近喜欢看海洋纪录片", confidence: 0.9, importance: 0.7, supersedes: false,
  }]);
  store.setFactVectorId(facts[0].id, "fact-vector");
  const chatExperience = store.upsertExperience({ kind: "chat", title: "会话经历", text: "只在第一段会话", sourceId: `chat:${first.id}:${user.id}`, sourceSessionId: first.id, sourceMessageId: user.id });
  store.setExperienceVectorId(chatExperience.id, "chat-vector");
  const firstVideoMessage = store.add("user", "分享一段蓝鲸视频", null, "chatgpt", first.id);
  const secondVideoMessage = store.add("user", "后来又一起看了一遍", null, "chatgpt", second.id);
  store.upsertExperience({ kind: "video", title: "蓝鲸的一天", text: "蓝鲸浮出海面换气。", sourceId: "video:shared-view", sourceSessionId: first.id, sourceMessageId: firstVideoMessage.id });
  store.upsertExperience({ kind: "video", title: "蓝鲸的一天", text: "蓝鲸浮出海面换气。", sourceId: "video:shared-view", sourceSessionId: second.id, sourceMessageId: secondVideoMessage.id });
  store.upsertExperience({ kind: "video", title: "蓝鲸的一天", text: "蓝鲸浮出海面换气。", sourceId: "video:shared-view", sourceSessionId: first.id, sourceMessageId: firstVideoMessage.id });
  const shared = store.upsertExperience({ kind: "learned", title: "共同话题", text: "两个会话都提到的内容", sourceId: "learned:chat:chatgpt:3:0", sourceSessionIds: [first.id, second.id] });
  store.setExperienceVectorId(shared.id, "shared-vector");
  store.addLegacyMemorySource("legacy-only", first.id);
  store.addLegacyMemorySource("legacy-shared", first.id);
  store.addLegacyMemorySource("legacy-shared", second.id);
  const removed: string[] = [];
  const memory = {
    async remember() { return []; }, async recall() { return []; }, async recentExperiences() { return []; },
    async recentLearnings() { return []; }, async addExperience() { return { id: "new", text: "", kind: "experience" as const }; },
    async list() { return []; }, async remove(id: string) { removed.push(id); },
  };
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([scripted(["好"])]), store, memory });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const renamed = await fetch(`${base}/api/chat/sessions/${first.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ character: "chatgpt", title: "关于海洋的聊天" }),
    });
    assert.equal(renamed.status, 200);
    store.add("user", "接着聊海洋", null, "chatgpt", first.id);
    assert.equal(store.getSession(first.id)?.title, "关于海洋的聊天");

    const deleted = await fetch(`${base}/api/chat/sessions/${first.id}?character=chatgpt`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(removed.sort(), ["chat-vector", "fact-vector", "legacy-only"].sort());
    assert.ok(store.getExperience(shared.id));
    const retainedVideo = store.experienceBySourceId("video:shared-view");
    assert.equal(retainedVideo?.sourceSessionId, second.id);
    assert.equal(retainedVideo?.sourceMessageId, secondVideoMessage.id);
    assert.equal(retainedVideo?.sourceMissing, false);
    assert.deepEqual(store.recent(10, "chatgpt", second.id).map((message) => message.content), ["这是一段保留中的会话", "后来又一起看了一遍"]);
    assert.equal(store.getSession(first.id), undefined);
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const videoSources = store.journalSources("chatgpt", from, to).filter((source) => source.type === "video");
    assert.deepEqual(videoSources.map((source) => [source.sessionId, source.messageId]), [[second.id, secondVideoMessage.id]]);
  } finally {
    server.close();
    store.close();
  }
});

test("removing a failed chat message clears its source link but keeps imported media", () => {
  const store = new ChatStore(":memory:");
  try {
    const session = store.createSession("whale", "一起看的视频");
    const message = store.add("user", "看看这个视频", null, "whale", session.id);
    const experience = store.upsertExperience({
      kind: "video",
      title: "蓝鲸的一天",
      text: "蓝鲸浮出海面换气。",
      sourceId: "video:failed-reply-cleanup",
      sourceSessionId: session.id,
      sourceMessageId: message.id,
    });

    store.remove(message.id);

    const retained = store.getExperience(experience.id);
    assert.equal(store.message(message.id), undefined);
    assert.equal(retained?.sourceMessageId, null);
    assert.equal(retained?.sourceSessionId, null);
    assert.equal(retained?.sourceMissing, true);
    assert.equal(retained?.text, "蓝鲸浮出海面换气。");
    const listed = store.listMemoryExplorer({ character: "whale", category: "video" });
    assert.equal(listed.items[0]?.sourceMissing, true);
  } finally {
    store.close();
  }
});

test("a failed repeat-view message falls back to the remaining video occurrence", () => {
  const store = new ChatStore(":memory:");
  try {
    const first = store.createSession("whale", "第一次看蓝鲸");
    const second = store.createSession("whale", "再次看蓝鲸");
    const firstMessage = store.add("user", "看看这段蓝鲸视频", null, "whale", first.id);
    const failedMessage = store.add("user", "再看一次同一条视频", null, "whale", second.id);
    const experience = store.upsertExperience({
      kind: "video",
      title: "蓝鲸的一天",
      text: "蓝鲸浮出海面换气。",
      sourceId: "video:repeat-view-failure",
      sourceSessionId: first.id,
      sourceMessageId: firstMessage.id,
    });
    store.upsertExperience({
      kind: "video",
      title: "蓝鲸的一天",
      text: "蓝鲸浮出海面换气。",
      sourceId: "video:repeat-view-failure",
      sourceSessionId: second.id,
      sourceMessageId: failedMessage.id,
    });

    store.remove(failedMessage.id);

    const retained = store.getExperience(experience.id);
    assert.equal(retained?.sourceSessionId, first.id);
    assert.equal(retained?.sourceMessageId, firstMessage.id);
    assert.equal(retained?.sourceMissing, false);
    const listed = store.listMemoryExplorer({ character: "whale", category: "video" });
    assert.equal(listed.items[0]?.sessionId, first.id);
    assert.equal(listed.items[0]?.messageId, firstMessage.id);
  } finally {
    store.close();
  }
});
