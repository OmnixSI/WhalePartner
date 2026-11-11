import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildCodexArgs, codexErrorFromEvents, parseCodexMessage, parseCodexResult, runCodexExec, summarizeWithCodex } from "../src/codex/exec.ts";
import {
  closeCodexAppServer,
  listCodexModels,
  resolveCodexSettings,
  supportedEffortsOf,
  GENERIC_REASONING_EFFORTS,
  streamWithCodexAppServer,
  type CodexModelOption,
} from "../src/codex/app-server.ts";
import { buildVideoSummaryPrompt } from "../src/video/prompt.ts";

test("builds a whole-video multimodal summary prompt", () => {
  const prompt = buildVideoSummaryPrompt(
    "标题：测试标题\n转写：字幕内容",
    [{ time: 30, reason: "subtitle aligned" }],
  );

  assert.equal(prompt.includes("整条视频"), true);
  assert.equal(prompt.includes("不要按时间段拆章节"), true);
  assert.equal(prompt.includes("`分享给你`"), true);
  assert.equal(prompt.includes("`来源与依据`"), true);
  assert.equal(prompt.includes("字幕内容"), true);
  assert.equal(prompt.includes("附图 1：30 秒"), true);
  assert.equal(prompt.includes("测试标题"), true);
  assert.equal(prompt.includes("评论与弹幕只反映采样到的观众反应"), true);
});

test("attaches keyframe images to GPT-6 Luna with a supported reasoning effort", () => {
  const args = buildCodexArgs(["/tmp/frame one.jpg", "/tmp/frame-two.jpg"], { model: "gpt-6-luna", effort: "low" });

  assert.equal(args.includes("gpt-6-luna"), true);
  assert.equal(args.includes('model_reasoning_effort="low"'), true);
  assert.deepEqual(
    args.flatMap((arg, index) => arg === "--image" ? [args[index + 1]] : []),
    ["/tmp/frame one.jpg", "/tmp/frame-two.jpg"],
  );
});

test("uses only an effort listed for the selected local Codex model", () => {
  const model: CodexModelOption = {
    model: "gpt-6-luna",
    id: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    isDefault: true,
  };

  assert.equal(resolveCodexSettings({ model: "gpt-6-luna", effort: "low" }, [model]).effort, "low");
  assert.throws(() => resolveCodexSettings({ model: "gpt-6-luna", effort: "none" }, [model]), /不在 gpt-6-luna 当前可用列表中/);
  assert.throws(() => resolveCodexSettings({ model: "custom-model", effort: "low" }, [model]), /当前没有可用模型/);
});

test("falls back to the generic effort list when Codex lists none for a model", () => {
  const model = { model: "gpt-bare", id: "gpt-bare", displayName: "gpt-bare", defaultReasoningEffort: "", supportedReasoningEfforts: [], isDefault: true };
  assert.deepEqual(supportedEffortsOf(model), [...GENERIC_REASONING_EFFORTS]);
  assert.equal(resolveCodexSettings({ model: "", effort: "" }, [model]).effort, GENERIC_REASONING_EFFORTS[0]);
  assert.equal(resolveCodexSettings({ model: "gpt-bare", effort: "high" }, [model]).effort, "high");
});

test("keeps the model's own default effort when Codex lists no efforts for it", () => {
  for (const own of ["max", "none", "minimal", "ultra"]) {
    const model = { model: "gpt-own", id: "gpt-own", displayName: "gpt-own", defaultReasoningEffort: own, supportedReasoningEfforts: [], isDefault: true };
    assert.deepEqual(supportedEffortsOf(model), [...GENERIC_REASONING_EFFORTS, own]);
    assert.equal(resolveCodexSettings({ model: "", effort: "" }, [model]).effort, own);
    assert.equal(resolveCodexSettings({ model: "gpt-own", effort: "low" }, [model]).effort, "low");
  }
  const inGeneric = { model: "gpt-own", id: "gpt-own", displayName: "gpt-own", defaultReasoningEffort: "high", supportedReasoningEfforts: [], isDefault: true };
  assert.deepEqual(supportedEffortsOf(inGeneric), [...GENERIC_REASONING_EFFORTS]);
  assert.equal(resolveCodexSettings({ model: "", effort: "" }, [inGeneric]).effort, "high");
});

test("does not start a Codex turn when cancelled while starting its thread", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whalepartner-codex-cancel-"));
  const executable = join(directory, "codex");
  const callLog = join(directory, "calls.log");
  const threadStarted = join(directory, "thread-started");
  const previousPath = process.env.PATH;

  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  fs.appendFileSync(process.env.CALL_LOG, message.method + "\\n");
  if (message.method === "thread/start") fs.writeFileSync(process.env.THREAD_STARTED, "yes");
  const result = message.method === "thread/start" ? { thread: { id: "thread-1" } } : {};
  setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n"), message.method === "thread/start" ? 250 : 0);
});
`);
  await chmod(executable, 0o755);
  process.env.PATH = `${directory}:${previousPath ?? ""}`;
  process.env.CALL_LOG = callLog;
  process.env.THREAD_STARTED = threadStarted;

  try {
    const controller = new AbortController();
    const pending = streamWithCodexAppServer("prompt", { model: "gpt-6-luna", effort: "low" }, controller.signal).next();
    const deadline = Date.now() + 5000;
    while (!existsSync(threadStarted)) {
      if (Date.now() >= deadline) throw new Error("Fake Codex did not receive thread/start.");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    controller.abort();
    await assert.rejects(pending, /Codex 对话已取消/);
    const calls = await readFile(callLog, "utf8");
    assert.equal(calls.includes("thread/start"), true);
    assert.equal(calls.includes("turn/start"), false);
  } finally {
    await closeCodexAppServer();
    process.env.PATH = previousPath;
    delete process.env.CALL_LOG;
    delete process.env.THREAD_STARTED;
    await rm(directory, { recursive: true, force: true });
  }
});

test("interrupts a Codex turn when cancelled before turn/start returns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whalepartner-codex-interrupt-"));
  const executable = join(directory, "codex");
  const callLog = join(directory, "calls.log");
  const turnStarted = join(directory, "turn-started");
  const previousPath = process.env.PATH;

  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  fs.appendFileSync(process.env.CALL_LOG, message.method + "\\n");
  if (message.method === "turn/start") fs.writeFileSync(process.env.TURN_STARTED, "yes");
  const result = message.method === "thread/start" ? { thread: { id: "thread-1" } } : message.method === "turn/start" ? { turn: { id: "turn-1" } } : {};
  setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n"), message.method === "turn/start" ? 250 : 0);
});
`);
  await chmod(executable, 0o755);
  process.env.PATH = `${directory}:${previousPath ?? ""}`;
  process.env.CALL_LOG = callLog;
  process.env.TURN_STARTED = turnStarted;

  try {
    const controller = new AbortController();
    const pending = streamWithCodexAppServer("prompt", { model: "gpt-6-luna", effort: "low" }, controller.signal).next();
    const deadline = Date.now() + 5000;
    while (!existsSync(turnStarted)) {
      if (Date.now() >= deadline) throw new Error("Fake Codex did not receive turn/start.");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    controller.abort();
    await assert.rejects(pending, /Codex 对话已取消/);
    const calls = await readFile(callLog, "utf8");
    assert.equal(calls.includes("turn/start"), true);
    assert.equal(calls.includes("turn/interrupt"), true);
  } finally {
    await closeCodexAppServer();
    process.env.PATH = previousPath;
    delete process.env.CALL_LOG;
    delete process.env.TURN_STARTED;
    await rm(directory, { recursive: true, force: true });
  }
});

test("ends a Codex app-server whose initialize failed and survives writes after it closed stdin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whalepartner-codex-restart-"));
  const executable = join(directory, "codex");
  const spawnLog = join(directory, "spawns.log");
  const previousPath = process.env.PATH;
  const spawned = async () => (await readFile(spawnLog, "utf8")).trim().split("\n").map(Number);

  // 第 1 个进程：initialize 报错但不退出；第 2 个：回应 initialize 前关掉 stdin、人还在；之后的正常工作。
  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(spawnLog)}, process.pid + "\\n");
const spawnIndex = fs.readFileSync(${JSON.stringify(spawnLog)}, "utf8").trim().split("\\n").length;
const reply = (id, body) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...body }) + "\\n");
// 保持存活，直到被结束；测试进程不在了也自己退出，不留孤儿。
const parent = process.ppid;
setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 200);
if (spawnIndex === 2) {
  // 同步读完 initialize 再真正关掉 fd 0（不经过 process.stdin，否则 libuv 会 abort），父进程之后再写只会 EPIPE。
  const buffer = Buffer.alloc(65536);
  let data = "";
  while (!data.includes("\\n")) {
    const size = fs.readSync(0, buffer);
    if (size === 0) break;
    data += buffer.toString("utf8", 0, size);
  }
  fs.closeSync(0);
  reply(JSON.parse(data.slice(0, data.indexOf("\\n"))).id, { result: {} });
} else {
  require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    if (message.method === "initialize") return reply(message.id, spawnIndex === 1 ? { error: { message: "初始化失败" } } : { result: {} });
    reply(message.id, { result: { data: [{ model: "fixture-model", defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "low" }] }], nextCursor: null } });
  });
}
`);
  await chmod(executable, 0o755);
  process.env.PATH = `${directory}:${previousPath ?? ""}`;

  try {
    await closeCodexAppServer();
    await assert.rejects(listCodexModels(), /初始化失败/);
    assert.equal(await processExits((await spawned())[0]), true, "初始化失败的进程要被结束，不能留成孤儿");

    // 往已关闭的 stdin 写会 EPIPE：只让这次请求失败，不能把 API 进程带崩。
    await assert.rejects(listCodexModels());
    assert.equal(await processExits((await spawned())[1]), true);

    assert.deepEqual((await listCodexModels()).map((model) => model.model), ["fixture-model"]);
    assert.equal((await spawned()).length, 3);
  } finally {
    await closeCodexAppServer();
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

async function processExits(pid: number, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test("reads the final completed Codex agent message from JSONL events", () => {
  const output = [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "旧摘要" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "## 摘要\n新摘要" } }),
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 6400, cached_input_tokens: 0, output_tokens: 380 },
    }),
  ].join("\n");

  assert.equal(parseCodexMessage(output), "## 摘要\n新摘要");
  assert.deepEqual(parseCodexResult(output), {
    message: "## 摘要\n新摘要",
    usage: { inputTokens: 6400, cachedInputTokens: 0, outputTokens: 380 },
  });
  assert.throws(() => parseCodexMessage('{"type":"turn.completed"}'), /没有返回摘要文本/);
});

test("extracts the API error Codex reports on stdout", () => {
  const inner = JSON.stringify({ error: { message: "Unsupported value: 'minimal'" } });
  const output = [
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "error", message: inner }),
    JSON.stringify({ type: "turn.failed", error: { message: inner } }),
  ].join("\n");
  assert.equal(codexErrorFromEvents(output), "Unsupported value: 'minimal'");
  assert.equal(codexErrorFromEvents("not json"), "");
});

test("kills the Codex process group when the video summary is aborted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whalepartner-codex-exec-abort-"));
  const executable = join(directory, "codex");
  const pidFile = join(directory, "pids");
  const previousPath = process.env.PATH;

  await writeFile(executable, `#!${process.execPath}
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const child = spawn("sleep", ["60"], { stdio: "ignore" });
fs.writeFileSync(process.env.PID_FILE, process.pid + " " + child.pid);
process.stdin.resume();
setInterval(() => {}, 1000);
`);
  await chmod(executable, 0o755);
  process.env.PATH = `${directory}:${previousPath ?? ""}`;
  process.env.PID_FILE = pidFile;

  try {
    const controller = new AbortController();
    const running = runCodexExec(["exec"], "", controller.signal);
    const deadline = Date.now() + 5000;
    while (!existsSync(pidFile)) {
      if (Date.now() >= deadline) throw new Error("Fake Codex 没有启动。");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const [parentPid, childPid] = (await readFile(pidFile, "utf8")).trim().split(" ").map(Number);

    controller.abort(new Error("用户按了停止"));
    await assert.rejects(running, /用户按了停止/);

    // 子进程组里的 Codex 和它拉起的 sleep 都要在几秒内结束。
    const gone = (pid: number) => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    };
    const stop = Date.now() + 5000;
    while (!gone(parentPid) || !gone(childPid)) {
      if (Date.now() >= stop) throw new Error("中止后 Codex 或它的子进程还在跑。");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    process.env.PATH = previousPath;
    delete process.env.PID_FILE;
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancelling while the Codex model list is pending rejects within a second, for listCodexModels and the video summary alike", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whalepartner-codex-models-abort-"));
  const executable = join(directory, "codex");
  const previousPath = process.env.PATH;

  // 只回 initialize，model/list 永远不答。
  await writeFile(executable, `#!${process.execPath}
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined || message.method === "model/list") return;
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\\n");
});
`);
  await chmod(executable, 0o755);
  process.env.PATH = `${directory}:${previousPath ?? ""}`;

  const settleWithin = async (pending: Promise<unknown>, controller: AbortController) => {
    const settled = pending.then(() => "resolved", (error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const abortedAt = Date.now();
    controller.abort();
    const outcome = await Promise.race([settled, new Promise((resolve) => setTimeout(() => resolve("still waiting"), 1_000))]);
    assert.notEqual(outcome, "still waiting", "取消 1 秒后仍在等模型列表");
    assert.notEqual(outcome, "resolved");
    assert.ok(Date.now() - abortedAt < 1_000);
  };

  try {
    const listing = new AbortController();
    await settleWithin(listCodexModels(listing.signal), listing);
    const summary = new AbortController();
    await settleWithin(summarizeWithCodex("prompt", [], summary.signal), summary);
  } finally {
    await closeCodexAppServer();
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
