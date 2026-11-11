import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { loadConfig } from "../src/server/config.ts";
import { buildCodexChatPrompt } from "../src/llm/codex-chat.ts";
import { OpenAiCompatibleProvider, ProviderError, readSseData } from "../src/llm/openai-compatible.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider, LlmDelta } from "../src/llm/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";

const SECRET = "sk-test-secret-123";
const MESSAGES = [{ role: "user" as const, content: "你好" }];

function listen(server: Server) {
  return new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

async function collect(stream: AsyncIterable<LlmDelta>) {
  const deltas: LlmDelta[] = [];
  for await (const delta of stream) deltas.push(delta);
  return deltas;
}

function fakeProvider(id: string, behavior: "ok" | "fail" | "fail-midway"): ChatProvider {
  return {
    id,
    model: `${id}-model`,
    async *stream() {
      if (behavior === "fail") throw new Error(`${id} down`);
      yield { text: `${id} 你好` };
      if (behavior === "fail-midway") throw new Error(`${id} broke`);
    },
  };
}

async function* chunks(parts: string[]) {
  for (const part of parts) yield new TextEncoder().encode(part);
}

test("parses SSE events split across chunks, CRLF and keepalive comments", async () => {
  const out: string[] = [];
  for await (const data of readSseData(chunks([": ping\n\ndata: {\"a\"", ":1}\r\n\r\ndata: [DO", "NE]\n\n"]))) out.push(data);
  assert.deepEqual(out, ['{"a":1}', "[DONE]"]);
});

test("streams text and DeepSeek-style usage, sending the key only as a bearer header", async () => {
  let seen: { auth?: string; body?: Record<string, unknown> } = {};
  const upstream = createServer(async (request, response) => {
    const raw: Buffer[] = [];
    for await (const chunk of request) raw.push(Buffer.from(chunk));
    seen = { auth: request.headers.authorization, body: JSON.parse(Buffer.concat(raw).toString()) };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
    response.write('data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":4,"prompt_cache_hit_tokens":12}}\n\n');
    response.end("data: [DONE]\n\n");
  });
  const base = await listen(upstream);
  try {
    const provider = new OpenAiCompatibleProvider({ id: "deepseek", baseUrl: `${base}/`, apiKey: SECRET, model: "deepseek-flash" });
    const deltas = await collect(provider.stream(MESSAGES));
    assert.equal(deltas.map((d) => d.text ?? "").join(""), "你好");
    assert.deepEqual(deltas.at(-1)?.usage, { inputTokens: 20, cachedInputTokens: 12, outputTokens: 4 });
    assert.equal(seen.auth, `Bearer ${SECRET}`);
    assert.equal(seen.body?.stream, true);
    assert.equal(seen.body?.model, "deepseek-flash");
    assert.equal(JSON.stringify(seen.body).includes(SECRET), false);
  } finally {
    upstream.close();
  }
});

test("upstream errors keep the status and never leak the key", async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `Invalid key ${SECRET}` } }));
  });
  const base = await listen(upstream);
  try {
    const provider = new OpenAiCompatibleProvider({ id: "deepseek", baseUrl: base, apiKey: SECRET, model: "m" });
    await assert.rejects(collect(provider.stream(MESSAGES)), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 401);
      assert.equal(error.message.includes(SECRET), false);
      return true;
    });
  } finally {
    upstream.close();
  }
});

test("a hung upstream times out instead of waiting forever", async () => {
  const upstream = createServer(() => {});
  const base = await listen(upstream);
  try {
    const provider = new OpenAiCompatibleProvider({ id: "deepseek", baseUrl: base, apiKey: SECRET, model: "m", timeoutMs: 80 });
    await assert.rejects(collect(provider.stream(MESSAGES)), /超时/);
  } finally {
    upstream.closeAllConnections();
    upstream.close();
  }
});

test("router falls back before any output, but not after output has started", async () => {
  const fallback = new FallbackChatProvider([fakeProvider("a", "fail"), fakeProvider("b", "ok")]);
  const deltas = await collect(fallback.stream(MESSAGES));
  assert.equal(deltas[0].provider, "b");
  assert.equal(deltas[0].text, "b 你好");

  const midway = new FallbackChatProvider([fakeProvider("a", "fail-midway"), fakeProvider("b", "ok")]);
  await assert.rejects(collect(midway.stream(MESSAGES)), /a broke/);

  const allFail = new FallbackChatProvider([fakeProvider("a", "fail"), fakeProvider("b", "fail")]);
  await assert.rejects(collect(allFail.stream(MESSAGES)), /所有模型提供方都失败了[\s\S]*a down[\s\S]*b down/);
});

test("router gives up on a stalled provider in time for the next one", async () => {
  const stalled: ChatProvider = {
    id: "deepseek",
    model: "m",
    async *stream(_messages, options) {
      await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      });
    },
  };
  const router = new FallbackChatProvider([stalled, fakeProvider("codex", "ok")]);
  const total = new AbortController();
  const timer = setTimeout(() => total.abort(new Error("first-token-timeout")), 400);
  try {
    const deltas = await collect(router.stream(MESSAGES, { signal: total.signal, firstTokenTimeoutMs: 200 }));
    assert.equal(deltas[0].provider, "codex", "主线路卡住时要在总预算内换到下一条");
  } finally {
    clearTimeout(timer);
  }

  const cancelled = new AbortController();
  const pending = collect(new FallbackChatProvider([stalled, fakeProvider("codex", "ok")]).stream(MESSAGES, { signal: cancelled.signal, firstTokenTimeoutMs: 10_000 }));
  cancelled.abort(new Error("user-cancel"));
  await assert.rejects(pending, /user-cancel/, "调用方取消时不换线路");
});

test("health reports the model chain and never exposes a key; CORS only for app origins", async () => {
  const config = loadConfig({ DEEPSEEK_API_KEY: SECRET });
  const provider = new FallbackChatProvider([fakeProvider("deepseek", "ok"), fakeProvider("codex", "ok")]);
  const server = createApiServer({ config, provider, store: new ChatStore(":memory:") });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/api/health`, { headers: { origin: "tauri://localhost" } });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "tauri://localhost");
    assert.equal(text.includes(SECRET), false);
    assert.deepEqual(JSON.parse(text), {
      ok: true,
      service: "whalepartner-api",
      provider: "deepseek",
      model: "deepseek-model",
      fallbacks: ["codex"],
      memory: { enabled: false, state: "idle" },
      memoryQueue: { pendingJobs: 0, retryingJobs: 0, pendingVectorIndexes: 0, pendingFactVectorIndexes: 0 },
      // B6.4：cron 摊成 HH:MM，界面用它显示「她一般什么时候写日记」。
      schedule: { journalTime: "20:30" },
    });

    const foreign = await fetch(`${base}/api/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(foreign.headers.get("access-control-allow-origin"), null);

    assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
  } finally {
    server.close();
  }
});

test("loads config with defaults, enables backup only when complete, rejects bad ports", () => {
  const base = loadConfig({});
  assert.equal(base.deepseek, undefined);
  assert.equal(base.port, 8787);
  assert.equal(base.host, "127.0.0.1");
  assert.equal(base.codexFallback, true);

  const full = loadConfig({
    DEEPSEEK_API_KEY: SECRET,
    BACKUP_LLM_BASE_URL: "https://backup.example/v1",
    BACKUP_LLM_API_KEY: "k2",
    BACKUP_LLM_MODEL: "m2",
    CODEX_FALLBACK: "0",
  });
  assert.equal(full.deepseek?.model, "deepseek-flash");
  assert.equal(full.backup?.model, "m2");
  assert.equal(full.codexFallback, false);

  assert.equal(loadConfig({ BACKUP_LLM_BASE_URL: "https://x", BACKUP_LLM_MODEL: "m" }).backup, undefined);
  assert.throws(() => loadConfig({ API_PORT: "abc" }), /API_PORT/);
});

test("builds a Codex fallback prompt that keeps the persona and the dialogue order", () => {
  const prompt = buildCodexChatPrompt([
    { role: "system", content: "你是鲸汐" },
    { role: "user", content: "早上好" },
    { role: "assistant", content: "早呀" },
    { role: "user", content: "今天做什么" },
  ]);
  assert.ok(prompt.indexOf("你是鲸汐") < prompt.indexOf("早上好"));
  assert.ok(prompt.indexOf("早呀") < prompt.indexOf("今天做什么"));
  assert.ok(prompt.trimEnd().endsWith("【你】"));
});
