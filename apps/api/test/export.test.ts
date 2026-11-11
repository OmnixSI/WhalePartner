import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { ChatProvider } from "../src/llm/types.ts";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";


/** B2：导出与删除全部的契约。 */

function fakeProvider(): ChatProvider {
  return {
    id: "deepseek",
    model: "deepseek-model",
    async *stream() { yield { type: "delta" as const, text: "嗯。" }; },
  } as unknown as ChatProvider;
}

function serve() {
  const store = new ChatStore(":memory:");
  const provider = new FallbackChatProvider([fakeProvider()]);
  const server = createApiServer({ config: loadConfig({}), provider, store });
  return new Promise<{ base: string; close: () => void; store: ChatStore }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close(), store });
    });
  });
}

test("export packs a zip and delete-all needs an explicit confirmation", async () => {
  const { base, close, store } = await serve();
  try {
    const session = store.getOrCreateSession("whale");
    store.add("user", "我想记住海玻璃要滚三天沙子", null, "whale", session.id);

    const created = await fetch(`${base}/api/export`, { method: "POST" });
    assert.equal(created.status, 201);
    const { id } = (await created.json()) as { id: string };
    assert.ok(id.length > 10);

    const download = await fetch(`${base}/api/export?id=${encodeURIComponent(id)}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/zip");
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", "zip 必须以本地文件头开头");

    const missing = await fetch(`${base}/api/export?id=nope`);
    assert.equal(missing.status, 404);

    const refused = await fetch(`${base}/api/data`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "nope" }),
    });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error, "confirm_required");

    const removed = await fetch(`${base}/api/data`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE_ALL" }),
    });
    assert.equal(removed.status, 200);
    assert.equal(store.recent(10, "whale").length, 0, "删除全部之后聊天记录应为空");
  } finally {
    close();
  }
});
