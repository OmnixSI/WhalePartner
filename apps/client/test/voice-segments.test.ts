import assert from "node:assert/strict";
import { test } from "node:test";
import { takeSpeechSegments } from "../src/components/chat/voice-segments.ts";

test("releases a complete natural sentence without waiting for the reply to finish", () => {
  const result = takeSpeechSegments("第一句内容足够完整，可以先开始合成。第二句还在生成");
  assert.deepEqual(result.ready, ["第一句内容足够完整，可以先开始合成。"]);
  assert.equal(result.remainder, "第二句还在生成");
});

test("keeps a short sentence with the next sentence to preserve a natural phrase", () => {
  const first = takeSpeechSegments("嗯。", false);
  assert.deepEqual(first.ready, []);
  const next = takeSpeechSegments(`${first.remainder}我会认真听你说完。`, false);
  assert.deepEqual(next.ready, ["嗯。我会认真听你说完。"]);
});

test("splits a long sentence at a clause boundary instead of cutting at a character count", () => {
  const clause = "这是一段比较长的自然语句，它还会继续解释当前的事情，并且会再补充一些必要的背景信息，让大家理解来龙去脉，然后还会继续说明后续的内容同时补充相关背景。";
  const result = takeSpeechSegments(clause);
  assert.deepEqual(result.ready, [
    "这是一段比较长的自然语句，它还会继续解释当前的事情，并且会再补充一些必要的背景信息，让大家理解来龙去脉，",
    "然后还会继续说明后续的内容同时补充相关背景。",
  ]);
  assert.equal(result.remainder, "");
});

test("flushes the final unfinished phrase at turn completion", () => {
  assert.deepEqual(takeSpeechSegments("最后这句还没有句号", true), {
    ready: ["最后这句还没有句号"],
    remainder: "",
  });
});
