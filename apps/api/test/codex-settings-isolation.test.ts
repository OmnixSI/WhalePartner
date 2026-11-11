import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import type { ChatProvider } from "../src/llm/types.ts";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";
import { closeCodexAppServer, type CodexModelOption } from "../src/codex/app-server.ts";
import { summarizeWithCodex } from "../src/codex/exec.ts";
import { CodexChatProvider } from "../src/llm/codex-chat.ts";

/**
 * 回归：用户自己的 Codex（桌面 / VS Code / CLI）在用别的模型和档位时，
 * 大肥鱼发给 Codex 的每个请求仍然只用「设置 › 模型接入」里选的值，
 * 而且保存设置不改用户的 `config.toml`。
 *
 * 用一个假的 `codex`（test/fixtures/fake-codex.cjs）顶替本机 Codex：它按 app-server / exec 两种方式应答，
 * 并把收到的参数逐行记下来，断言就看这份记录。
 */

const root = mkdtempSync(join(tmpdir(), "wp-codex-isolation-"));
const codexHome = join(root, "codex-home");
const dataDir = join(root, "wp-data");
const binDir = join(root, "bin");
const logPath = join(root, "fake-codex.log");
mkdirSync(codexHome, { recursive: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(binDir, { recursive: true });

const MODELS = [
  { model: "gpt-user-codex", displayName: "User Codex Model", efforts: ["low", "xhigh"], isDefault: true },
  { model: "gpt-wp-chosen", displayName: "WP Chosen Model", efforts: ["low", "medium", "high"], isDefault: false },
];

// 假 `codex`：shell 包装再交给 node 跑 fixture，PATH 里排在真的 Codex 前面。
const fakeScript = join(import.meta.dirname, "fixtures", "fake-codex.cjs");
writeFileSync(join(binDir, "codex"), `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, "utf8");
chmodSync(join(binDir, "codex"), 0o755);

// 仿 ARIS 的 shim：放在 PATH 最前面，把 `codex exec` 的 -m / model_reasoning_effort 换成它钉死的值，
// 其余子命令原样交给后面的 codex。大肥鱼必须绕过它，而不是按名字 spawn 到它。
const shimDir = join(root, "shim-bin");
const shimHits = join(root, "shim-hits.log");
mkdirSync(shimDir, { recursive: true });
writeFileSync(join(shimDir, "codex"), `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
appendFileSync(${JSON.stringify(shimHits)}, process.argv.slice(2).join(" ") + "\\n");
let args = process.argv.slice(2);
if (args[0] === "exec") {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-m") { i++; continue; }
    if (args[i] === "-c" && args[i + 1].startsWith("model_reasoning_effort")) { i++; continue; }
    out.push(args[i]);
  }
  args = [...out.slice(0, -1), "-m", "gpt-user-codex", "-c", "model_reasoning_effort=xhigh", "-"];
}
const result = spawnSync(${JSON.stringify(join(binDir, "codex"))}, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`, "utf8");
chmodSync(join(shimDir, "codex"), 0o755);

const ENV_NAMES = ["PATH", "WP_CODEX_BIN", "CODEX_HOME", "WP_DATA_DIR", "FAKE_CODEX_LOG", "FAKE_CODEX_MODELS"] as const;
const savedEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
process.env.PATH = `${shimDir}${delimiter}${binDir}${delimiter}${process.env.PATH ?? ""}`;
delete process.env.WP_CODEX_BIN;
process.env.CODEX_HOME = codexHome;
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

const userConfigPath = join(codexHome, "config.toml");
const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function fakeProvider(id: string, model: string): ChatProvider {
  return { id, model, async *stream() { yield { text: "嗯。" }; } } as unknown as ChatProvider;
}

const ROUTE_MODELS: CodexModelOption[] = MODELS.map((item) => ({
  model: item.model,
  id: item.model,
  displayName: item.displayName,
  defaultReasoningEffort: item.efforts[0],
  supportedReasoningEfforts: item.efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
  isDefault: item.isDefault,
}));

function readLog(): Array<{ kind: string; method?: string; params?: Record<string, unknown>; args?: string[] }> {
  try {
    return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test("用户自己的 Codex 在用别的模型时，大肥鱼的请求仍按设置里的模型和档位发出，且不改用户的 config.toml", async () => {
  // 用户的 Codex 一开始的默认值。
  writeFileSync(userConfigPath, `model = "gpt-user-codex"\nmodel_reasoning_effort = "low"\n\n[features]\njs_repl = false\n`, "utf8");
  const before = hash(userConfigPath);

  // 1. 用户在大肥鱼的设置里选 gpt-wp-chosen · high 并保存。
  const store = new ChatStore(":memory:");
  const provider = new FallbackChatProvider([fakeProvider("deepseek", "deepseek-flash")]);
  const server = createApiServer({ config: loadConfig({}), provider, store, codexModels: async () => ROUTE_MODELS });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const saved = await fetch(`http://127.0.0.1:${port}/api/setup/codex`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-wp-chosen", effort: "high" }),
    });
    assert.equal(saved.status, 200);
  } finally {
    // 等 close 事件真的触发：它会顺手关掉 Codex app-server，不能让它落在后面的推理请求中间。
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(hash(userConfigPath), before, "保存大肥鱼的设置不能改用户 Codex 的 config.toml");

  // 2. 用户随后在自己的 Codex 里换了模型和档位（Codex 会把选择写回 config.toml）。
  writeFileSync(userConfigPath, `model = "gpt-user-codex"\nmodel_reasoning_effort = "xhigh"\n\n[features]\njs_repl = false\n`, "utf8");
  const userChanged = hash(userConfigPath);

  // 3. 大肥鱼聊天走 app-server：thread/start 和 turn/start 都必须显式带设置值。
  const chat = new CodexChatProvider();
  assert.equal(chat.model, "gpt-wp-chosen");
  let text = "";
  for await (const delta of chat.stream([{ role: "user", content: "你好" }])) text += delta.text;
  assert.equal(text, "好");
  const rpc = readLog().filter((entry) => entry.kind === "rpc");
  const threadStart = rpc.find((entry) => entry.method === "thread/start");
  const turnStart = rpc.find((entry) => entry.method === "turn/start");
  assert.equal(threadStart?.params?.model, "gpt-wp-chosen");
  assert.equal(turnStart?.params?.model, "gpt-wp-chosen");
  assert.equal(turnStart?.params?.effort, "high");

  // 4. 视频摘要走 codex exec：不读用户配置，-m 和 effort 都是设置值。
  const result = await summarizeWithCodex("总结一下");
  assert.equal(result.model, "gpt-wp-chosen");
  assert.equal(result.reasoningEffort, "high");
  const exec = readLog().find((entry) => entry.kind === "exec");
  assert.ok(exec?.args, "应当调用了 codex exec");
  assert.ok(exec.args.includes("--ignore-user-config"));
  assert.equal(exec.args[exec.args.indexOf("-m") + 1], "gpt-wp-chosen");
  assert.ok(exec.args.includes(`model_reasoning_effort="high"`));

  assert.ok(!exec.args.includes("gpt-user-codex"), "exec 参数不能被包装脚本改写");
  assert.ok(!existsSync(shimHits), "聊天和视频摘要都不能经过会改写模型参数的包装脚本");

  // 5. 整个过程大肥鱼没有再碰用户的 config.toml。
  assert.equal(hash(userConfigPath), userChanged, "推理请求不能改用户 Codex 的 config.toml");
});
