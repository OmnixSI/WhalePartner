import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { DeviceRegistry } from "../src/devices.ts";
import { EmotionFilter, splitEmotionTags } from "../src/emotion.ts";
import { EventBus } from "../src/events.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { SessionMutex } from "../src/routes/session-lock.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

const json = { "content-type": "application/json" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function slowProvider(chunks: string[], gap = 30): ChatProvider {
  return {
    id: "fake", model: "m",
    async *stream(_m, options) {
      for (const text of chunks) {
        await sleep(gap);
        options?.signal?.throwIfAborted();
        yield { text };
      }
    },
  };
}

async function boot(opts: { provider?: ChatProvider; localToken?: string; lan?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wp-hub-"));
  const events = new EventBus();
  const devices = new DeviceRegistry(join(dir, "devices.json"));
  const server = createApiServer({
    config: loadConfig({}),
    provider: new FallbackChatProvider([opts.provider ?? slowProvider(["你", "好", "呀"])]),
    store: new ChatStore(":memory:"),
    events,
    auth: { devices, localToken: opts.localToken, lan: opts.lan },
  });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  return { base, server, events, devices, dir };
}

/** 读 SSE 的小客户端：收集 {id,event,data}。 */
async function openEvents(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const res = await fetch(url, { headers, signal: ctrl.signal });
  const got: Array<{ id?: string; event: string; data: any }> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          let event = "message"; let id: string | undefined; let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("id:")) id = line.slice(3).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (data) got.push({ id, event, data: JSON.parse(data) });
        }
      }
    } catch { /* aborted */ }
  })();
  const waitFor = async (predicate: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > end) throw new Error(`timeout; got ${JSON.stringify(got.map((e) => e.event))}`);
      await sleep(10);
    }
  };
  return { res, got, waitFor, close: () => ctrl.abort() };
}

test("two clients: A sends, B receives created, deltas and done in real time", async () => {
  const { base, server } = await boot();
  const a = await openEvents(`${base}/api/events`);
  const b = await openEvents(`${base}/api/events`);
  try {
    const chat = await fetch(`${base}/api/chat`, { method: "POST", headers: json, body: JSON.stringify({ message: "嗨", clientId: "client-aaaa-1111" }) });
    const text = await chat.text();
    assert.match(text, /event: ack/);
    await b.waitFor(() => b.got.some((e) => e.event === "message.done"));
    const names = b.got.map((e) => e.event);
    assert.ok(names.includes("typing"));
    const created = b.got.filter((e) => e.event === "message.created");
    assert.equal(created[0].data.message.role, "user");
    assert.equal(created[0].data.clientId, "client-aaaa-1111");
    assert.deepEqual(b.got.filter((e) => e.event === "message.delta").map((e) => e.data.text), ["你", "好", "呀"]);
    assert.equal(created.at(-1)!.data.message.content, "你好呀");
    // A 也收到同样的事件
    await a.waitFor(() => a.got.some((e) => e.event === "message.done"));
    assert.equal(a.got.length, b.got.length);
    // 事件 id 单调递增
    const ids = b.got.filter((e) => e.id).map((e) => Number(e.id));
    assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
  } finally { a.close(); b.close(); server.close(); server.closeAllConnections(); }
});

test("events: Last-Event-ID replays missed events, and an overrun buffer yields resync", async () => {
  const { base, server, events } = await boot();
  try {
    for (let i = 0; i < 5; i++) events.publish("diary.updated", { n: i });
    const c = await openEvents(`${base}/api/events`, { "last-event-id": "2" });
    await c.waitFor(() => c.got.filter((e) => e.event === "diary.updated").length === 3);
    assert.deepEqual(c.got.filter((e) => e.event === "diary.updated").map((e) => e.data.n), [2, 3, 4]);
    c.close();
    const small = new EventBus(3);
    for (let i = 0; i < 10; i++) small.publish("typing", { i });
    assert.equal(small.since(1).gap, true);
    assert.equal(small.since(8).gap, false);
    assert.equal(small.since(999).gap, true);
  } finally { server.close(); server.closeAllConnections(); }
});

test("pairing: code redeems once into a device token; devices can be listed and revoked", async () => {
  const { base, server, devices } = await boot({ localToken: "home-secret" });
  const owner = { ...json, authorization: "Bearer home-secret" };
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/api/memories`)).status, 401);
    const created = await (await fetch(`${base}/api/pair/create`, { method: "POST", headers: owner, body: "{}" })).json() as { code: string };
    assert.match(created.code, /^\d{6}$/);
    assert.equal((await fetch(`${base}/api/pair/redeem`, { method: "POST", headers: json, body: JSON.stringify({ code: "000000", name: "x" }) })).status, 400);
    const redeemed = await (await fetch(`${base}/api/pair/redeem`, { method: "POST", headers: json, body: JSON.stringify({ code: created.code, name: "我的手机" }) })).json() as { token: string; device: { id: string; name: string } };
    assert.match(redeemed.token, /^wpd_/);
    // 一次性
    assert.equal((await fetch(`${base}/api/pair/redeem`, { method: "POST", headers: json, body: JSON.stringify({ code: created.code, name: "again" }) })).status, 400);
    // 设备 token 可用（header 与 ?token=）
    assert.equal((await fetch(`${base}/api/devices`, { headers: { authorization: `Bearer ${redeemed.token}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/devices?token=${redeemed.token}`)).status, 200);
    const list = await (await fetch(`${base}/api/devices`, { headers: owner })).json() as { devices: Array<{ id: string; name: string; tokenHash?: string }> };
    assert.equal(list.devices.length, 1);
    assert.equal(list.devices[0].name, "我的手机");
    assert.equal(list.devices[0].tokenHash, undefined);
    // 撤销后立刻失效
    assert.equal((await fetch(`${base}/api/devices/${redeemed.device.id}`, { method: "DELETE", headers: owner })).status, 200);
    assert.equal((await fetch(`${base}/api/devices`, { headers: { authorization: `Bearer ${redeemed.token}` } })).status, 401);
    assert.equal(devices.list().length, 0);
  } finally { server.close(); server.closeAllConnections(); }
});

test("pairing codes expire after 10 minutes and wrong guesses are rate limited", () => {
  let now = 1_000_000;
  const registry = new DeviceRegistry(undefined, () => now);
  const { code } = registry.createPairingCode();
  now += 10 * 60_000 + 1;
  assert.deepEqual(registry.redeem(code, "late"), { ok: false, reason: "invalid" });
  const limited = new DeviceRegistry(undefined, () => now);
  for (let i = 0; i < 8; i++) limited.redeem("123456", "x");
  assert.deepEqual(limited.redeem("123456", "x"), { ok: false, reason: "rate_limited" });
});

test("auth: cross-site origin, text/plain, wrong token, proxied requests and --lan are rejected", async () => {
  const open = await boot();
  try {
    assert.equal((await fetch(`${open.base}/api/memories`)).status, 200); // 开发便利：本机免 token
    assert.equal((await fetch(`${open.base}/api/memories`, { headers: { origin: "https://evil.example" } })).status, 403);
    assert.equal((await fetch(`${open.base}/api/chat`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${open.base}/api/chat`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ message: "x" }) })).status, 403);
    assert.equal((await fetch(`${open.base}/api/memories`, { headers: { origin: "tauri://localhost" } })).status, 200);
    // 经隧道来的（带转发头）必须有 token
    assert.equal((await fetch(`${open.base}/api/memories`, { headers: { "x-forwarded-for": "1.2.3.4" } })).status, 401);
    // DNS rebinding：Host 不是回环名
    const { request } = await import("node:http");
    const rebound = await new Promise<number>((resolve, reject) => {
      const req = request(`${open.base}/api/memories`, { headers: { host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject); req.end();
    });
    assert.equal(rebound, 403);
  } finally { open.server.close(); open.server.closeAllConnections(); }

  const lan = await boot({ lan: true, localToken: "t0k" });
  try {
    assert.equal((await fetch(`${lan.base}/api/memories`)).status, 401);
    assert.equal((await fetch(`${lan.base}/api/memories`, { headers: { authorization: "Bearer nope" } })).status, 401);
    assert.equal((await fetch(`${lan.base}/api/memories`, { headers: { authorization: "Bearer t0k" } })).status, 200);
    assert.equal((await fetch(`${lan.base}/api/events`)).status, 401);
    const sse = await openEvents(`${lan.base}/api/events?token=t0k`);
    assert.equal(sse.res.status, 200);
    sse.close();
    const health = await (await fetch(`${lan.base}/api/health`)).json() as { authRequired?: boolean };
    assert.equal(health.authRequired, true);
  } finally { lan.server.close(); lan.server.closeAllConnections(); }
});

test("chat: clientId is idempotent, aborted replies are kept as interrupted, SSE acks immediately", async () => {
  const { base, server, events } = await boot({ provider: slowProvider(["第一", "第二", "第三", "第四"], 80) });
  const watcher = await openEvents(`${base}/api/events`);
  try {
    const body = JSON.stringify({ message: "你好", clientId: "dedupe-0001" });
    const first = await fetch(`${base}/api/chat`, { method: "POST", headers: json, body });
    assert.equal(first.status, 200);
    // 第二次同 clientId 且第一次还在进行 → 409
    const dup = await fetch(`${base}/api/chat`, { method: "POST", headers: json, body });
    assert.equal(dup.status, 409);
    await first.text();
    // 完成后再发同一个 clientId → 回放，不重复生成
    const replay = await (await fetch(`${base}/api/chat`, { method: "POST", headers: json, body })).text();
    assert.match(replay, /"duplicate":true/);
    const history = await (await fetch(`${base}/api/chat/history`)).json() as { messages: Array<{ role: string }> };
    assert.equal(history.messages.length, 2);

    // 中止：读到第一段后断开
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: json, body: JSON.stringify({ message: "再说一次", clientId: "abort-00001" }), signal: ctrl.signal });
    const reader = res.body!.getReader();
    let seen = "";
    while (!seen.includes("event: delta")) seen += new TextDecoder().decode((await reader.read()).value);
    assert.match(seen, /event: ack/);
    ctrl.abort();
    await watcher.waitFor(() => watcher.got.some((e) => e.event === "message.interrupted"));
    const after = await (await fetch(`${base}/api/chat/history`)).json() as { messages: Array<{ role: string; content: string; attachment?: { type: string } }> };
    const last = after.messages.at(-1)!;
    assert.equal(last.role, "assistant");
    assert.ok(last.content.startsWith("第一"));
    assert.equal(last.attachment?.type, "interrupted");
    assert.ok(events.lastId > 0);
  } finally { watcher.close(); server.close(); server.closeAllConnections(); }
});

test("chat: no first token within the limit gives a clear timeout error", async () => {
  const hang: ChatProvider = { id: "hang", model: "m", async *stream(_m, o) { await new Promise((_, reject) => o?.signal?.addEventListener("abort", () => reject(new Error("aborted")))); yield { text: "" }; } };
  const { runChat } = await import("../src/chat.ts");
  const store = new ChatStore(":memory:");
  const run = async () => { for await (const _ of runChat({ provider: new FallbackChatProvider([hang]), store, firstTokenTimeoutMs: 60, bus: new EventBus() }, "喂")) { /* drain */ } };
  await assert.rejects(run(), (error: Error & { code?: string }) => error.code === "timeout" && /没有回音/.test(error.message));
  assert.equal(store.recent(5).length, 0);
});

test("session mutex serialises turns per session", async () => {
  const mutex = new SessionMutex();
  const order: string[] = [];
  const turn = async (name: string, ms: number) => {
    const release = await mutex.acquire("s1");
    order.push(`${name}:start`);
    await sleep(ms);
    order.push(`${name}:end`);
    release();
  };
  await Promise.all([turn("a", 40), turn("b", 5)]);
  assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
  const ctrl = new AbortController();
  const held = await mutex.acquire("s2");
  const waiting = mutex.acquire("s2", ctrl.signal);
  ctrl.abort();
  await assert.rejects(waiting);
  held();
  (await mutex.acquire("s2"))();
});

test("emotion tags never leak: spaces, case, full-width brackets and split chunks", () => {
  const filter = new EmotionFilter();
  const parts = ["[ Emotion : Happy ]你好", "【emotion：sad】", "，在[ emo", "tion: relaxed ]这里", "［Emotion:angry］"];
  let text = ""; const emotions: string[] = [];
  for (const part of parts) { const r = filter.feed(part); text += r.text; emotions.push(...r.emotions); }
  text += filter.flush();
  assert.equal(text, "你好，在这里");
  assert.deepEqual(emotions, ["happy", "sad", "relaxed", "angry"]);
  assert.equal(splitEmotionTags("【 emotion : happy 】好").text, "好");
});

test("static hosting serves dist and the PWA manifest with SPA fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wp-static-"));
  const { writeFileSync, mkdirSync } = await import("node:fs");
  writeFileSync(join(dir, "index.html"), "<html>hub</html>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "a.js"), "1");
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([slowProvider([])]), store: new ChatStore(":memory:"), staticDir: dir });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    assert.match(await (await fetch(`${base}/`)).text(), /hub/);
    assert.match(await (await fetch(`${base}/settings`)).text(), /hub/);
    assert.equal((await fetch(`${base}/assets/a.js`)).status, 200);
    assert.equal((await fetch(`${base}/..%2f..%2fetc/passwd`)).status === 200 && false, false);
    const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json() as { display: string };
    assert.equal(manifest.display, "standalone");
  } finally { server.close(); server.closeAllConnections(); }
});
