import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCodexArgs, CODEX_REASONING_EFFORT, codexErrorFromEvents, parseCodexMessage, parseCodexResult } from "../src/codex.ts";
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
  const args = buildCodexArgs(["/tmp/frame one.jpg", "/tmp/frame-two.jpg"]);

  assert.equal(args.includes("gpt-6-luna"), true);
  assert.equal(args.includes(`model_reasoning_effort="${CODEX_REASONING_EFFORT}"`), true);
  assert.notEqual(CODEX_REASONING_EFFORT, "minimal");
  assert.deepEqual(
    args.flatMap((arg, index) => arg === "--image" ? [args[index + 1]] : []),
    ["/tmp/frame one.jpg", "/tmp/frame-two.jpg"],
  );
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
