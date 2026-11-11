import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";

const provider: ChatProvider = {
  id: "fixture",
  model: "fixture-model",
  async *stream() { yield { text: "好" }; },
};

test("companion settings and page presence routes validate and persist", async () => {
  const store = new ChatStore(":memory:");
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const initial = await (await fetch(`${base}/api/companion/settings`)).json() as { enabled: boolean; quiet: { start: string; end: string } };
    assert.equal(initial.enabled, false);
    assert.deepEqual(initial.quiet, { start: "23:00", end: "08:00" });

    const saved = await fetch(`${base}/api/companion/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, frequency: "normal" }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json() as { enabled: boolean }).enabled, true);
    const invalid = await fetch(`${base}/api/companion/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frequency: "often" }),
    });
    assert.equal(invalid.status, 400);

    const presence = await fetch(`${base}/api/chat/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "device-client-123", character: "deepseek", visible: true, active: true, busy: false, voicePlaying: false }),
    });
    assert.equal(presence.status, 204);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});
