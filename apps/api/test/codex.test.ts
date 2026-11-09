import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildCodexArgs, codexErrorFromEvents, parseCodexMessage, parseCodexResult } from "../src/codex.ts";
import {
  closeCodexAppServer,
  resolveCodexSettings,
  streamWithCodexAppServer,
  type CodexModelOption,
} from "../src/codex-app-server.ts";
import { buildVideoSummaryPrompt } from "../src/prompt.ts";

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
