import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";
import { closeCodexAppServer } from "../src/codex/app-server.ts";
import { codexSettingsPath } from "../src/codex/settings.ts";
import { CodexChatProvider } from "../src/llm/codex-chat.ts";

/**
 * 回归：升级后还没有 codex-settings.json（或首次使用没保存过选择）时，推理按 Codex 模型列表的默认项走，
 * 「测试连接」（/api/health?probe=1）报告的模型也必须是同一个，不能回退到写死的名字再误报「模型不可用」。
 */

const root = mkdtempSync(join(tmpdir(), "wp-codex-default-"));
const dataDir = join(root, "wp-data");
const binDir = join(root, "bin");
const logPath = join(root, "fake-codex.log");
mkdirSync(join(root, "codex-home"), { recursive: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(binDir, { recursive: true });

// 默认模型故意不是 Luna。
const MODELS = [
  { model: "gpt-catalog-default", displayName: "Catalog Default", efforts: ["high", "low"], isDefault: true },
  { model: "gpt-6-luna-other", displayName: "Other", efforts: ["low"], isDefault: false },
];

const fakeScript = join(import.meta.dirname, "fixtures", "fake-codex.cjs");
writeFileSync(join(binDir, "codex"), `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, "utf8");
chmodSync(join(binDir, "codex"), 0o755);

const ENV_NAMES = ["PATH", "WP_CODEX_BIN", "CODEX_HOME", "WP_DATA_DIR", "FAKE_CODEX_LOG", "FAKE_CODEX_MODELS"] as const;
const savedEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;
delete process.env.WP_CODEX_BIN;
process.env.CODEX_HOME = join(root, "codex-home");
process.env.WP_DATA_DIR = dataDir;
process.env.FAKE_CODEX_LOG = logPath;
process.env.FAKE_CODEX_MODELS = JSON.stringify(MODELS);

after(async () => {
  await closeCodexAppServer();
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

test("没保存过 Codex 设置时，测试连接报告的模型与实际推理用的默认模型一致", async () => {
  assert.equal(existsSync(codexSettingsPath()), false, "前提：没有 codex-settings.json");

  const chat = new CodexChatProvider();
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([chat]), store: new ChatStore(":memory:") });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health?probe=1`)).json();
    assert.equal(health.model, "gpt-catalog-default");
    assert.equal(health.probe.checked, true);
    assert.equal(health.probe.modelAvailable, true);

    let text = "";
    for await (const delta of chat.stream([{ role: "user", content: "你好" }])) text += delta.text;
    assert.equal(text, "好");
    const rpc = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry.kind === "rpc");
    const turnStart = rpc.find((entry) => entry.method === "turn/start");
    assert.equal(turnStart?.params?.model, health.model, "推理请求和测试连接必须是同一个模型");
    assert.equal(turnStart?.params?.effort, "high");
    assert.equal(chat.model, "gpt-catalog-default", "解析过一次后，健康检查不带 probe 也报告同一个模型");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
