import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { runChat, type ChatEvent } from "../src/chat.ts";
import { loadConfig } from "../src/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatMessage, ChatProvider } from "../src/llm/types.ts";
import { withUserName } from "../src/persona/persona.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

async function collect(events: AsyncIterable<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function withServer(store: ChatStore, run: (base: string) => Promise<void>) {
  const config = loadConfig({});
  const provider = new FallbackChatProvider([{ id: "fake", model: "fake", async *stream() { yield { text: "好" }; } }]);
  const server = createApiServer({ config, provider, store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    await run(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const headers = { "content-type": "application/json" };

test("PUT and GET /api/profile round-trip the nickname", async () => {
  const store = new ChatStore(":memory:");
  await withServer(store, async (base) => {
    const empty = (await (await fetch(`${base}/api/profile`)).json()) as { nickname: string | null };
    assert.equal(empty.nickname, null);

    const put = await fetch(`${base}/api/profile`, { method: "PUT", headers, body: JSON.stringify({ nickname: " 小周 " }) });
    assert.equal(put.status, 200);
    assert.deepEqual(await put.json(), { nickname: "小周" });
    assert.deepEqual(await (await fetch(`${base}/api/profile`)).json(), { nickname: "小周" });

    const clear = await fetch(`${base}/api/profile`, { method: "PUT", headers, body: JSON.stringify({ nickname: null }) });
    assert.equal(clear.status, 200);
    assert.deepEqual(await clear.json(), { nickname: null });
    assert.deepEqual(await (await fetch(`${base}/api/profile`)).json(), { nickname: null });
  });
  store.close();
});

test("invalid nicknames are rejected with invalid_nickname", async () => {
  const store = new ChatStore(":memory:");
  await withServer(store, async (base) => {
    const bad: unknown[] = ["", "   ", "一二三四五六七八九十一二三", "a\nb", "a\tb", "<b>", "`x`", 42, undefined];
    for (const nickname of bad) {
      const res = await fetch(`${base}/api/profile`, { method: "PUT", headers, body: JSON.stringify(nickname === undefined ? {} : { nickname }) });
      assert.equal(res.status, 400, `应拒绝：${String(nickname)}`);
      const body = (await res.json()) as { error: string; message: string };
      assert.equal(body.error, "invalid_nickname");
      assert.match(body.message, /1 到 12 个字/);
    }
    assert.deepEqual(await (await fetch(`${base}/api/profile`)).json(), { nickname: null });
  });
  store.close();
});

test("withUserName appends the naming instruction only when a nickname exists", () => {
  const core = "# 角色设定：鲸汐";
  assert.equal(withUserName(core, null), core);
  assert.equal(withUserName(core, ""), core);
  assert.equal(withUserName(core, undefined), core);
  const injected = withUserName(core, "小周");
  assert.ok(injected.startsWith(core));
  assert.ok(injected.includes("对方希望你称呼 TA 为「小周」。"));
  assert.ok(injected.includes("自然地偶尔使用"));
});

test("runChat puts the nickname into the system prompt", async () => {
  const seen: ChatMessage[][] = [];
  const provider: ChatProvider = {
    id: "fake",
    model: "fake",
    async *stream(messages) {
      seen.push(messages);
      yield { text: "[emotion:happy]在的呀" };
    },
  };
  const store = new ChatStore(":memory:");
  await collect(runChat({ provider, store, nickname: "小周" }, "在吗"));
  assert.ok(seen[0][0].content.includes("称呼 TA 为「小周」"));

  await collect(runChat({ provider, store }, "在吗"));
  assert.equal(seen[1][0].content.includes("称呼 TA 为"), false);
  store.close();
});

test("deleting all data clears the nickname", async () => {
  const store = new ChatStore(":memory:");
  await withServer(store, async (base) => {
    await fetch(`${base}/api/profile`, { method: "PUT", headers, body: JSON.stringify({ nickname: "小周" }) });
    const del = await fetch(`${base}/api/data`, { method: "DELETE", headers, body: JSON.stringify({ confirm: "DELETE_ALL" }) });
    assert.equal(del.status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/profile`)).json(), { nickname: null });
  });
  store.close();
});
