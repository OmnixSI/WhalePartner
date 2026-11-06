import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { runChat, type ChatEvent } from "../src/chat.ts";
import { loadConfig } from "../src/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatMessage, ChatProvider } from "../src/llm/types.ts";
import { startLlmBridge } from "../src/memory/llm-bridge.ts";
import { recallChatMemory } from "../src/memory/recall.ts";
import type { ConversationTurn, ExperienceInput, MemoryEntry, MemoryStore } from "../src/memory/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

function fakeMemory(overrides: Partial<MemoryStore> = {}) {
  const calls = { remembered: [] as ConversationTurn[][], experiences: [] as ExperienceInput[], removed: [] as string[], queries: [] as string[], recentLearningReads: 0, recentExperienceReads: 0 };
  const store: MemoryStore = {
    async recentLearnings() { calls.recentLearningReads += 1; return []; },
    async remember(turns) { calls.remembered.push(turns); },
    async recall(query) { calls.queries.push(query); return [{ id: "f1", kind: "fact", text: "用户养了一只叫团子的猫" }]; },
    async recentExperiences() { calls.recentExperienceReads += 1; return [{ id: "e1", kind: "experience", text: "深海纪录片\n讲了发光水母" }]; },
    async addExperience(input) { calls.experiences.push(input); return { id: "e2", kind: "experience", text: input.text, title: input.title, sourceId: input.sourceId }; },
    async list() { return [{ id: "f1", kind: "fact", text: "用户养了一只叫团子的猫" }] satisfies MemoryEntry[]; },
    async remove(id) { calls.removed.push(id); },
    ...overrides,
  };
  return { store, calls };
}

function scripted(seen: ChatMessage[][]): ChatProvider {
  return { id: "fake", model: "m", async *stream(messages) { seen.push(messages); yield { text: "[emotion:happy]团子呀" }; } };
}

async function collect(events: AsyncIterable<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

test("chat recalls facts into the prompt without exposing recall diagnostics and remembers the turn afterwards", async () => {
  const seen: ChatMessage[][] = [];
  const { store: memory, calls } = fakeMemory();
  const query = "我的猫叫什么？最近我们一起看过什么？";
  const events = await collect(runChat({ provider: new FallbackChatProvider([scripted(seen)]), store: new ChatStore(":memory:"), memory }, query));
  await flush();

  assert.deepEqual(events.map((e) => e.type), ["emotion", "delta", "done"]);
  assert.deepEqual(calls.queries, [query]);
  const system = seen[0].filter((message) => message.role === "system").map((message) => message.content).join("\n");
  assert.ok(system.includes("无原始消息来源") && system.includes("用户养了一只叫团子的猫"));
  assert.ok(system.includes("<experience_evidence>") && system.includes("发光水母"));
  assert.equal(calls.recentLearningReads, 0);
  assert.deepEqual(calls.remembered, [[{ role: "user", content: query }, { role: "assistant", content: "团子呀" }]]);
});

test("semantic recall adds only relevant learned material with its archived source", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "分享的纪录片");
  const archived = store.upsertExperience({
    kind: "learned",
    title: "新知识",
    text: "鲸鱼会通过声音进行远距离交流。",
    sourceId: "learned:video:BV1WHALE:0",
    sourceSessionIds: [session.id],
  });
  const { store: memory, calls } = fakeMemory({
    async search() {
      return [{
        id: "learned-vector",
        kind: "experience",
        source: "learned",
        title: archived.title,
        sourceId: archived.sourceId,
        createdAt: archived.createdAt,
        text: archived.text,
      }];
    },
  });

  try {
    assert.equal(store.experienceVisibleToCharacter(archived.sourceId, "whale"), true);
    const recall = await recallChatMemory({ store, memory, character: "whale", sessionId: session.id, query: "那次纪录片提到的知识是什么？" });
    assert.equal(recall.learned.length, 1, JSON.stringify(recall));
    assert.match(recall.learned[0], /鲸鱼会通过声音进行远距离交流/);
    assert.match(recall.learned[0], /learned:video:BV1WHALE:0/);
    assert.equal(recall.experiences.length, 0);
    assert.equal(calls.recentLearningReads, 0);
  } finally {
    store.close();
  }
});

test("semantic recall does not expose another character's session-scoped video", async () => {
  const store = new ChatStore(":memory:");
  const whaleSession = store.createSession("whale", "鲸鱼分享");
  const otherSession = store.createSession("claude", "另一个角色");
  const archived = store.upsertExperience({
    kind: "video",
    title: "鲸鱼纪录片",
    text: "鲸鱼在海面跃出水面。",
    sourceId: "BV1PRIVATEVIDEO",
    sourceSessionIds: [whaleSession.id],
  });
  const memory = fakeMemory({
    async search() {
      return [{
        id: "video-vector",
        kind: "experience",
        source: "video",
        title: archived.title,
        sourceId: archived.sourceId,
        createdAt: archived.createdAt,
        text: archived.text,
      }];
    },
  }).store;

  try {
    const recall = await recallChatMemory({ store, memory, character: "claude", sessionId: otherSession.id, query: "鲸鱼纪录片讲了什么？" });
    assert.equal(recall.experiences.length, 0);
  } finally {
    store.close();
  }
});

test("recent chat questions use archived shared experiences without listing vector memory", async () => {
  const store = new ChatStore(":memory:");
  const session = store.createSession("whale", "视频分享");
  store.upsertExperience({
    kind: "video", title: "鲸鱼纪录片", text: "鲸鱼在海面跃出水面。",
    sourceId: "BV1RECENTVIDEO", sourceSessionIds: [session.id],
  });
  const { store: memory, calls } = fakeMemory();

  try {
    const recall = await recallChatMemory({ store, memory, character: "whale", sessionId: session.id, query: "最近我们一起看过什么？" });
    assert.equal(recall.experiences.length, 1);
    assert.match(recall.experiences[0], /鲸鱼纪录片/);
    assert.equal(calls.recentExperienceReads, 0);
  } finally {
    store.close();
  }
});

test("a failing memory never breaks chat", async () => {
  const seen: ChatMessage[][] = [];
  const broken = fakeMemory({
    async recall() { throw new Error("向量模型下载失败"); },
    async recentExperiences() { throw new Error("坏了"); },
    async remember() { throw new Error("写入失败"); },
  }).store;
  const events = await collect(runChat({ provider: new FallbackChatProvider([scripted(seen)]), store: new ChatStore(":memory:"), memory: broken }, "你好"));
  await flush();
  assert.deepEqual(events.map((e) => e.type), ["emotion", "delta", "done"]);
  assert.equal(seen[0][0].content.includes("你记得的关于用户的事"), false);
});

test("a cancelled reply is not remembered", async () => {
  const { store: memory, calls } = fakeMemory();
  const abort = new AbortController();
  const provider: ChatProvider = { id: "slow", model: "m", async *stream() { yield { text: "半句" }; abort.abort(); yield { text: "话" }; } };
  await assert.rejects(collect(runChat({ provider, store: new ChatStore(":memory:"), memory }, "喂", abort.signal)));
  await flush();
  assert.equal(calls.remembered.length, 0);
});

async function withServer(memory: MemoryStore | undefined, run: (base: string) => Promise<void>) {
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([scripted([])]), store: new ChatStore(":memory:"), memory });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try { await run(base); } finally { server.close(); }
}

const json = { "content-type": "application/json" };

test("memory routes list, delete and add experiences with validation", async () => {
  const { store, calls } = fakeMemory();
  await withServer(store, async (base) => {
    const list = (await (await fetch(`${base}/api/memories`)).json()) as { entries: MemoryEntry[] };
    assert.equal(list.entries[0].text, "用户养了一只叫团子的猫");

    assert.equal((await fetch(`${base}/api/memories/f%2F1`, { method: "DELETE" })).status, 200);
    assert.deepEqual(calls.removed, ["f/1"]);

    const ok = await fetch(`${base}/api/memories/experience`, { method: "POST", headers: json, body: JSON.stringify({ kind: "video", title: "深海纪录片", text: "讲了发光水母", sourceId: "BV1X", url: "https://www.bilibili.com/video/BV1X" }) });
    assert.equal(ok.status, 200);
    assert.deepEqual(calls.experiences[0], { kind: "video", title: "深海纪录片", text: "讲了发光水母", url: "https://www.bilibili.com/video/BV1X", sourceId: "BV1X" });

    for (const bad of [{ kind: "video", title: "", text: "x" }, { kind: "video", title: "t", text: "x", url: "javascript:alert(1)" }, { title: "t", text: "x" }]) {
      assert.equal((await fetch(`${base}/api/memories/experience`, { method: "POST", headers: json, body: JSON.stringify(bad) })).status, 400);
    }
    assert.equal((await fetch(`${base}/api/memories/experience`, { method: "POST", body: "{oops" })).status, 400);
    assert.equal(calls.experiences.length, 1);
  });
});

test("memory routes report a disabled memory and surface store failures", async () => {
  await withServer(undefined, async (base) => {
    const memories = await fetch(`${base}/api/memories`);
    assert.equal(memories.status, 200);
    assert.deepEqual(await memories.json(), { entries: [], vectorError: "语义记忆索引未启用。" });
    const health = (await (await fetch(`${base}/api/health`)).json()) as { memory: { enabled: boolean } };
    assert.equal(health.memory.enabled, false);
  });
  const failing = fakeMemory({ async list() { throw new Error("磁盘满了"); } }).store;
  await withServer(failing, async (base) => {
    const res = await fetch(`${base}/api/memories`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { entries: [], vectorError: "磁盘满了" });
  });
});

test("the mem0 LLM bridge requires its token and relays chat completions through the provider chain", async () => {
  const seen: ChatMessage[][] = [];
  const provider: ChatProvider = {
    id: "p", model: "m",
    async *stream(messages) {
      seen.push(messages);
      yield { text: '{"facts":["用户有一只猫"]}' };
      yield { usage: { inputTokens: 7, cachedInputTokens: 0, outputTokens: 3 } };
    },
  };
  const bridge = await startLlmBridge(provider);
  try {
    const url = `${bridge.baseUrl}/chat/completions`;
    const body = JSON.stringify({ model: "x", messages: [{ role: "system", content: "提取事实" }, { role: "user", content: "我有只猫" }], response_format: { type: "json_object" } });
    assert.equal((await fetch(url, { method: "POST", headers: json, body })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { ...json, authorization: "Bearer wrong" }, body })).status, 401);

    const res = await fetch(url, { method: "POST", headers: { ...json, authorization: `Bearer ${bridge.apiKey}` }, body });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }>; usage: { total_tokens: number } };
    assert.equal(data.choices[0].message.content, '{"facts":["用户有一只猫"]}');
    assert.equal(data.usage.total_tokens, 10);
    assert.equal(seen[0].at(-1)?.content.includes("JSON"), true);
  } finally {
    bridge.close();
  }
});
