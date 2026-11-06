import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { runChat, type ChatEvent } from "../src/chat.ts";
import { loadConfig } from "../src/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatMessage, ChatProvider } from "../src/llm/types.ts";
import { QuotaExceededError, QuotaService, UNIT_COSTS } from "../src/quota.ts";
import { createApiServer, type ServerDeps } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

function scripted(chunks: string[], seen?: ChatMessage[][]): ChatProvider {
  return {
    id: "fake",
    model: "fake-model",
    async *stream(messages) {
      seen?.push(messages);
      for (const text of chunks) yield { text };
    },
  };
}

async function collect(events: AsyncIterable<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
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

test("a fresh ledger has used=0 and the full monthly allowance", () => {
  const store = new ChatStore(":memory:");
  const quota = new QuotaService(store.db, loadConfig({}), () => new Date(2026, 10, 7, 12));
  const summary = quota.summary();
  assert.equal(summary.billing, "off");
  assert.equal(summary.enforced, false);
  assert.equal(summary.total, 3000);
  assert.equal(summary.used, 0);
  assert.equal(summary.remaining, 3000);
  assert.equal(summary.low, false);
  assert.deepEqual(summary.breakdown, { chat: 0, video: 0, web: 0, journal: 0, surf: 0 });
  assert.deepEqual(summary.costs, { chat: 1, video: 20, web: 3, journal: 5, surfVideo: 20, surfWeb: 3 });
  assert.equal(summary.today.used, 0);
  assert.equal(summary.period.start, "2026-11-01");
  assert.equal(summary.period.end, "2026-11-30");
  assert.match(summary.period.resetsAt, /^2026-12-01T00:00:00[+-]\d{2}:\d{2}$/);
  store.close();
});

test("recording units updates used, breakdown, remaining and today", () => {
  const store = new ChatStore(":memory:");
  const quota = new QuotaService(store.db, loadConfig({}), () => new Date(2026, 10, 7, 12));
  quota.record("chat", UNIT_COSTS.chat, { character: "whale" });
  quota.record("chat", UNIT_COSTS.chat);
  quota.record("video", UNIT_COSTS.video, { character: "claude", meta: { surf: "video" } });
  quota.record("journal", UNIT_COSTS.journal);
  const summary = quota.summary();
  assert.equal(summary.used, 1 + 1 + 20 + 5);
  assert.deepEqual(summary.breakdown, { chat: 2, video: 20, web: 0, journal: 5, surf: 0 });
  assert.equal(summary.remaining, 3000 - 27);
  assert.equal(summary.today.used, 27);
  assert.equal(summary.low, false);
  store.close();
});

test("records from a previous month do not count toward this month", () => {
  const store = new ChatStore(":memory:");
  const config = loadConfig({});
  const october = new QuotaService(store.db, config, () => new Date(2026, 9, 15, 12));
  october.record("chat", 7);
  const november = new QuotaService(store.db, config, () => new Date(2026, 10, 7, 12));
  november.record("web", 3);
  const summary = november.summary();
  assert.equal(summary.used, 3);
  assert.equal(summary.breakdown.chat, 0);
  assert.equal(summary.breakdown.web, 3);
  assert.equal(summary.today.used, 3);
  store.close();
});

test("low is true once less than a fifth of the allowance is left", () => {
  const store = new ChatStore(":memory:");
  const quota = new QuotaService(store.db, loadConfig({ QUOTA_MONTHLY_UNITS: "10" }), () => new Date(2026, 10, 7, 12));
  quota.record("journal", 9);
  const summary = quota.summary();
  assert.equal(summary.remaining, 1);
  assert.equal(summary.low, true);
  assert.equal(quota.isLow(), true);
  store.close();
});

test("enforcement throws only when QUOTA_ENFORCE=1 and the allowance is short", () => {
  const store = new ChatStore(":memory:");
  const enforced = new QuotaService(store.db, loadConfig({ QUOTA_ENFORCE: "1", QUOTA_MONTHLY_UNITS: "10" }));
  enforced.record("chat", 10);
  assert.throws(() => enforced.assertAvailable(1), QuotaExceededError);
  assert.throws(() => enforced.assertAvailable(1), /贝壳/);
  enforced.assertAvailable(0);
  const relaxed = new QuotaService(store.db, loadConfig({ QUOTA_MONTHLY_UNITS: "10" }));
  relaxed.assertAvailable(5);
  store.close();
});

test("POST /api/chat returns 402 quota_exceeded when enforced and empty", async () => {
  const store = new ChatStore(":memory:");
  const config = loadConfig({ QUOTA_ENFORCE: "1", QUOTA_MONTHLY_UNITS: "1" });
  const quota = new QuotaService(store.db, config);
  quota.record("chat", 1);
  const provider = new FallbackChatProvider([scripted(["在的"])]);
  await withServer({ config, provider, store, quota }, async (base) => {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "嗨" }) });
    assert.equal(res.status, 402);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, "quota_exceeded");
    assert.match(body.message, /贝壳/);
    assert.equal(store.recent(10).length, 0);
  });
  store.close();
});

test("with enforcement off, an exhausted ledger still lets chat through", async () => {
  const store = new ChatStore(":memory:");
  const quota = new QuotaService(store.db, loadConfig({ QUOTA_MONTHLY_UNITS: "1" }));
  quota.record("chat", 1);
  const events = await collect(runChat({ provider: new FallbackChatProvider([scripted(["[emotion:happy]在的"])]), store, quota }, "你在吗"));
  assert.equal(events.at(-1)?.type, "done");
  store.close();
});

test("one chat reply writes exactly one chat row", async () => {
  const store = new ChatStore(":memory:");
  const quota = new QuotaService(store.db, loadConfig({}));
  await collect(runChat({ provider: new FallbackChatProvider([scripted(["[emotion:happy]早上好呀"])]), store, quota }, "早上好"));
  const rows = store.db.prepare("SELECT kind, units, character FROM usage_ledger").all() as unknown as Array<Record<string, unknown>>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [{ kind: "chat", units: 1, character: "whale" }]);
  store.close();
});

test("GET /api/quota returns the documented schema field by field", async () => {
  const store = new ChatStore(":memory:");
  const config = loadConfig({ QUOTA_MONTHLY_UNITS: "3000" });
  const quota = new QuotaService(store.db, config);
  quota.record("journal", 5, { character: "whale" });
  await withServer({ config, provider: new FallbackChatProvider([scripted(["好"])]), store, quota }, async (base) => {
    const res = await fetch(`${base}/api/quota`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.billing, "off");
    assert.equal(body.enforced, false);
    assert.equal(typeof body.total, "number");
    assert.equal(typeof body.used, "number");
    assert.equal(typeof body.remaining, "number");
    assert.equal(typeof body.low, "boolean");
    assert.deepEqual(body.breakdown, { chat: 0, video: 0, web: 0, journal: 5, surf: 0 });
    assert.deepEqual(body.costs, { chat: 1, video: 20, web: 3, journal: 5, surfVideo: 20, surfWeb: 3 });
    const period = body.period as Record<string, unknown>;
    assert.deepEqual(Object.keys(period).sort(), ["end", "resetsAt", "start"]);
    assert.match(String(period.start), /^\d{4}-\d{2}-01$/);
    assert.match(String(period.end), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(String(period.resetsAt), /^\d{4}-\d{2}-01T00:00:00[+-]\d{2}:\d{2}$/);
    const today = body.today as Record<string, unknown>;
    assert.equal(today.used, 5);
  });
  store.close();
});
