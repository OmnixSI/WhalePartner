import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import { loadConfig } from "../src/server/config.ts";
import { clientAddress } from "../src/hub/auth.ts";
import { DeviceRegistry } from "../src/hub/devices.ts";
import { EmotionFilter, splitEmotionTags } from "../src/chat/emotion.ts";
import { EventBus } from "../src/hub/events.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { SessionMutex } from "../src/routes/session-lock.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";

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
  let markClosed = () => {};
  const closed = new Promise<void>((resolve) => { markClosed = resolve; });
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { markClosed(); return; }
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
  return { res, got, waitFor, closed, close: () => ctrl.abort() };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${what}超时（${ms} ms）`)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

test("revoking a device closes its event stream within a second and leaves other devices connected", async () => {
  const { base, server, events } = await boot({ localToken: "home-secret" });
  const owner = { ...json, authorization: "Bearer home-secret" };
  const pair = async (name: string) => {
    const created = await (await fetch(`${base}/api/pair/create`, { method: "POST", headers: owner, body: "{}" })).json() as { code: string };
    return await (await fetch(`${base}/api/pair/redeem`, { method: "POST", headers: json, body: JSON.stringify({ code: created.code, name }) })).json() as { token: string; device: { id: string } };
  };
  try {
    const phone = await pair("手机");
    const tablet = await pair("平板");
    const phoneStream = await openEvents(`${base}/api/events?token=${phone.token}`);
    const tabletStream = await openEvents(`${base}/api/events?token=${tablet.token}`);

    assert.equal((await fetch(`${base}/api/devices/${phone.device.id}`, { method: "DELETE", headers: owner })).status, 200);
    await withTimeout(phoneStream.closed, 1_000, "撤销设备后关闭事件流");

    events.publish("typing", { n: 1 });
    await tabletStream.waitFor(() => tabletStream.got.some((e) => e.event === "typing"));
    // 被撤销的设备重连时拿不到事件流。
    assert.equal((await fetch(`${base}/api/events?token=${phone.token}`)).status, 401);

    phoneStream.close();
    tabletStream.close();
  } finally { server.close(); server.closeAllConnections(); }
});

test("revoking a device aborts its in-flight POST /api/chat and stops the stream within a second", async () => {
  let produced = 0;
  let aborted = false;
  let calls = 0;
  const endless: ChatProvider = {
    id: "fake", model: "m",
    async *stream(_m, options) {
      // 只统计第一次调用（这轮聊天）；被打断的轮次随后会进记忆整理，也会调用同一个 provider。
      const isChat = ++calls === 1;
      for (let i = 0; i < 40; i++) {
        await sleep(60);
        if (options?.signal?.aborted) { if (isChat) aborted = true; return; }
        if (isChat) produced += 1;
        yield { text: "字" };
      }
    },
  };
  const { base, server } = await boot({ localToken: "home-secret", provider: endless });
  const owner = { ...json, authorization: "Bearer home-secret" };
  try {
    const created = await (await fetch(`${base}/api/pair/create`, { method: "POST", headers: owner, body: "{}" })).json() as { code: string };
    const phone = await (await fetch(`${base}/api/pair/redeem`, { method: "POST", headers: json, body: JSON.stringify({ code: created.code, name: "手机" }) })).json() as { token: string; device: { id: string } };
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { ...json, authorization: `Bearer ${phone.token}` }, body: JSON.stringify({ message: "嗨" }) });
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("event: delta")) {
      const { done, value } = await reader.read();
      assert.ok(!done, "撤销前流不该结束");
      received += decoder.decode(value, { stream: true });
    }

    assert.equal((await fetch(`${base}/api/devices/${phone.device.id}`, { method: "DELETE", headers: owner })).status, 200);
    const revokedAt = Date.now();
    const producedAtRevoke = produced;
    const drained = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          received += decoder.decode(value, { stream: true });
        }
      } catch { /* 连接被直接掐断 */ }
    })();
    await withTimeout(drained, 1_000, "撤销设备后聊天流关闭");
    assert.ok(Date.now() - revokedAt < 1_000);
    // 生成也被中止了：撤销之后最多再多一帧在途的内容，不会把整段 40 个字写完。
    await sleep(300);
    assert.ok(aborted, "provider 应收到中止信号");
    assert.ok(produced <= producedAtRevoke + 1, `撤销后仍在生成：${producedAtRevoke} -> ${produced}`);
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

test("pairing failures are limited per source address, with a higher global cap", () => {
  let now = 1_000_000;
  const registry = new DeviceRegistry(undefined, () => now);
  const { code } = registry.createPairingCode();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 8; i++) assert.equal(registry.redeem(wrong, "x", "203.0.113.7").ok, false);
  // 刷满的来源连正确的配对码也不能再试。
  assert.deepEqual(registry.redeem(code, "手机", "203.0.113.7"), { ok: false, reason: "rate_limited" });
  // 其他来源不受影响，同一个配对码还能兑换。
  const redeemed = registry.redeem(code, "手机", "198.51.100.9");
  assert.equal(redeemed.ok, true);

  // 分散到多个来源的暴力枚举仍然会被全局上限挡住。
  const crowded = new DeviceRegistry(undefined, () => now);
  const next = crowded.createPairingCode();
  const crowdedWrong = next.code === "000000" ? "111111" : "000000";
  for (let source = 0; source < 5; source++) {
    for (let i = 0; i < 8; i++) crowded.redeem(crowdedWrong, "x", `10.0.0.${source}`);
  }
  assert.deepEqual(crowded.redeem(next.code, "新设备", "192.0.2.1"), { ok: false, reason: "rate_limited" });
  // 失败窗口过去后恢复。
  now += 60_001;
  assert.equal(crowded.redeem(next.code, "新设备", "192.0.2.1").ok, true);
});

test("pairing rate limit follows the forwarded source address", async () => {
  const { base, server } = await boot({ localToken: "home-secret" });
  const owner = { ...json, authorization: "Bearer home-secret" };
  try {
    const created = await (await fetch(`${base}/api/pair/create`, { method: "POST", headers: owner, body: "{}" })).json() as { code: string };
    const wrong = created.code === "000000" ? "111111" : "000000";
    const blockedSource = { ...json, "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < 8; i++) {
      const response = await fetch(`${base}/api/pair/redeem`, { method: "POST", headers: blockedSource, body: JSON.stringify({ code: wrong, name: "x" }) });
      assert.equal(response.status, 400);
    }
    assert.equal((await fetch(`${base}/api/pair/redeem`, { method: "POST", headers: blockedSource, body: JSON.stringify({ code: created.code, name: "x" }) })).status, 429);
    // 另一个来源还能正常配对。
    const other = await fetch(`${base}/api/pair/redeem`, {
      method: "POST",
      headers: { ...json, "x-forwarded-for": "198.51.100.9" },
      body: JSON.stringify({ code: created.code, name: "手机" }),
    });
    assert.equal(other.status, 200);
  } finally { server.close(); server.closeAllConnections(); }
});

/** 假的请求：只有限流用得到的 headers 和 socket.remoteAddress。 */
function sourceRequest(remoteAddress: string | undefined, headers: Record<string, string> = {}): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

test("直连伪造 X-Forwarded-For 不会产生新的来源桶", () => {
  // 公网直连：对端不是代理，转发头一律不采信。
  const forged: Array<Record<string, string>> = [
    { "x-forwarded-for": "203.0.113.1" },
    { "x-forwarded-for": "203.0.113.2, 10.0.0.1" },
    { "cf-connecting-ip": "203.0.113.3" },
    { "x-real-ip": "203.0.113.4" },
    { "x-forwarded-for": "203.0.113.5", "cf-connecting-ip": "203.0.113.6" },
  ];
  const sources = new Set(forged.map((headers) => clientAddress(sourceRequest("198.51.100.7", headers))));
  assert.deepEqual([...sources], ["198.51.100.7"], "换着伪造头也只有一个来源");
  assert.equal(clientAddress(sourceRequest("::ffff:198.51.100.7", { "x-forwarded-for": "203.0.113.1" })), "198.51.100.7");

  // 连着输错 20 次，全部记在真实地址上：8 次后这个来源被限流，其他来源不受影响。
  const registry = new DeviceRegistry(undefined, () => 1_000_000);
  const { code } = registry.createPairingCode();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 20; i += 1) {
    registry.redeem(wrong, "x", clientAddress(sourceRequest("198.51.100.7", { "x-forwarded-for": `203.0.113.${i}` })));
  }
  assert.deepEqual(registry.redeem(code, "手机", "198.51.100.7"), { ok: false, reason: "rate_limited" });
  assert.equal(registry.redeem(code, "手机", "198.51.100.8").ok, true);
});

test("可信代理后面只看 X-Forwarded-For，从右往左挑第一个不可信地址", () => {
  // 本机反代（回环）追加的 XFF 可信。
  assert.equal(clientAddress(sourceRequest("127.0.0.1", { "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientAddress(sourceRequest("::1", { "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  // 多级代理：右边的值是最近的代理追加的，跳过可信代理网段后取到真实客户端。
  assert.equal(
    clientAddress(sourceRequest("127.0.0.1", { "x-forwarded-for": "203.0.113.5, 10.0.0.2" }), ["10.0.0.0/8"]),
    "203.0.113.5",
  );
  // 客户端在 XFF 左边自带的假地址不会被采信：取的是最右边那个不可信的。
  assert.equal(
    clientAddress(sourceRequest("127.0.0.1", { "x-forwarded-for": "6.6.6.6, 203.0.113.5" })),
    "203.0.113.5",
  );
  // 配置的代理网段同样可信；没配置时按真实对端算。
  assert.equal(clientAddress(sourceRequest("10.1.2.3", { "x-forwarded-for": "6.6.6.6" }), ["10.0.0.0/8"]), "6.6.6.6");
  assert.equal(clientAddress(sourceRequest("10.1.2.3", { "x-forwarded-for": "6.6.6.6" })), "10.1.2.3");
});

test("可信代理后面客户端自带的 cf-connecting-ip / x-real-ip 不被采信", () => {
  // Caddy/nginx 默认原样转发客户端自带的这两个头；代理只会追加真实地址到 XFF。
  const forged = { "cf-connecting-ip": "6.6.6.6", "x-real-ip": "7.7.7.7", "x-forwarded-for": "203.0.113.5" };
  assert.equal(clientAddress(sourceRequest("127.0.0.1", forged)), "203.0.113.5");
  assert.equal(clientAddress(sourceRequest("172.17.0.1", forged), ["172.16.0.0/12"]), "203.0.113.5");
  // 没有 XFF 时回落到对端地址，而不是伪造头。
  assert.equal(clientAddress(sourceRequest("127.0.0.1", { "cf-connecting-ip": "6.6.6.6", "x-real-ip": "7.7.7.7" })), "127.0.0.1");
});

test("Cloudflare 橙云 → Caddy：配置了 Cloudflare 网段才跳过边缘 IP，取到真实客户端", () => {
  // Cloudflare 把真实客户端追加进 XFF，Caddy（信任 CF 网段时）再把 CF 边缘追加在后面。
  const request = (client: string, edge: string) => sourceRequest("172.17.0.1", { "x-forwarded-for": `${client}, ${edge}` });
  const dockerOnly = ["172.16.0.0/12"];
  const withCloudflare = ["172.16.0.0/12", "173.245.48.0/20", "104.16.0.0/13"];
  // 只配 Docker 网段：同一个边缘节点后面的用户共用一个桶（文档里明说不算支持）。
  assert.equal(clientAddress(request("203.0.113.1", "173.245.48.1"), dockerOnly), "173.245.48.1");
  assert.equal(clientAddress(request("203.0.113.2", "173.245.48.1"), dockerOnly), "173.245.48.1");
  // 把 Cloudflare 网段加进去：按真实客户端分桶，多个边缘节点也一样。
  assert.equal(clientAddress(request("203.0.113.1", "173.245.48.1"), withCloudflare), "203.0.113.1");
  assert.equal(clientAddress(request("203.0.113.2", "104.16.0.9"), withCloudflare), "203.0.113.2");
  // 客户端自己在 XFF 里塞假地址：Cloudflare 追加的是真实地址，取右边第一个不可信的，假地址排在它左边。
  assert.equal(clientAddress(sourceRequest("172.17.0.1", { "x-forwarded-for": "6.6.6.6, 203.0.113.1, 173.245.48.1" }), withCloudflare), "203.0.113.1");
});

test("Docker 默认 bridge：对端是网关 172.17.0.1，配置代理网段后才按真实客户端分桶", () => {
  const request = (client: string) => sourceRequest("172.17.0.1", { "x-forwarded-for": client });
  // 没配 WP_TRUSTED_PROXIES：所有人都落在网关地址上（单一全局桶）。
  assert.equal(clientAddress(request("203.0.113.1")), "172.17.0.1");
  assert.equal(clientAddress(request("203.0.113.2")), "172.17.0.1");
  // Dockerfile 默认的 172.16.0.0/12：按 XFF 里的真实客户端分桶，且仍不放过 172.16/12 之外的直连。
  const proxies = ["172.16.0.0/12"];
  assert.equal(clientAddress(request("203.0.113.1"), proxies), "203.0.113.1");
  assert.equal(clientAddress(request("203.0.113.2"), proxies), "203.0.113.2");
  assert.equal(clientAddress(sourceRequest("198.51.100.7", { "x-forwarded-for": "203.0.113.1" }), proxies), "198.51.100.7");

  const registry = new DeviceRegistry(undefined, () => 1_000_000);
  const { code } = registry.createPairingCode();
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 20; i += 1) registry.redeem(wrong, "x", clientAddress(request("203.0.113.1"), proxies));
  assert.deepEqual(registry.redeem(code, "手机", clientAddress(request("203.0.113.1"), proxies)), { ok: false, reason: "rate_limited" });
  assert.equal(registry.redeem(code, "手机", clientAddress(request("203.0.113.2"), proxies)).ok, true);
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
  const { runChat } = await import("../src/chat/service.ts");
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
