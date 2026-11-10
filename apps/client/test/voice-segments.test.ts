import assert from "node:assert/strict";
import { test } from "node:test";
import { takeQueuedSpeechBatch, takeSpeechSegments } from "../src/components/chat/voice-segments.ts";

test("releases a complete natural sentence without waiting for the reply to finish", () => {
  const sentence = "第一句内容已经足够完整而且表达了清楚的意思我们可以先开始合成。";
  const result = takeSpeechSegments(`${sentence}第二句还在生成`);
  assert.deepEqual(result.ready, [sentence]);
  assert.equal(result.remainder, "第二句还在生成");
});

test("releases a natural clause at its comma while the sentence is still arriving", () => {
  const firstClause = "第一句内容已经足够完整，";
  const remainder = "而且表达了清楚的意思还在生成";
  assert.deepEqual(takeSpeechSegments(firstClause + remainder), {
    ready: [firstClause],
    remainder,
  });
});

test("keeps a short sentence with the next sentence to preserve a natural phrase", () => {
  const first = takeSpeechSegments("嗯。", false);
  assert.deepEqual(first.ready, []);
  const next = takeSpeechSegments(`${first.remainder}我会认真听你说完，也会记住你刚才提到的细节。`, false);
  assert.deepEqual(next.ready, ["嗯。我会认真听你说完，也会记住你刚才提到的细节。"]);
});

test("combines consecutive short sentences until the request is long enough", () => {
  const result = takeSpeechSegments("好。嗯。可以。我们现在就开始处理这件事。");
  assert.deepEqual(result.ready, ["好。嗯。可以。我们现在就开始处理这件事。"]);
  assert.equal(result.remainder, "");
});

test("splits a long sentence at a clause boundary instead of cutting at a character count", () => {
  const clause = "这是一段比较长的自然语句，它还会继续解释当前的事情，并且会再补充一些必要的背景信息，让大家理解来龙去脉，然后还会继续说明后续的内容同时补充相关背景。";
  const result = takeSpeechSegments(clause);
  assert.deepEqual(result.ready, [
    "这是一段比较长的自然语句，",
    "它还会继续解释当前的事情，",
    "并且会再补充一些必要的背景信息，",
    "让大家理解来龙去脉，然后还会继续说明后续的内容同时补充相关背景。",
  ]);
  assert.equal(result.remainder, "");
});

test("flushes the final unfinished phrase at turn completion", () => {
  assert.deepEqual(takeSpeechSegments("最后这句还没有句号", true), {
    ready: ["最后这句还没有句号"],
    remainder: "",
  });
});

test("starts the first TTS request without batching queued sentences", () => {
  const first = { text: "首句。", turnId: "turn-1", segmentIndex: 0, emotion: "neutral", characterId: "deepseek" };
  const queued = [
    { text: "第二句。", turnId: "turn-1", segmentIndex: 1, emotion: "neutral", characterId: "deepseek" },
    { text: "Third sentence.", turnId: "turn-1", segmentIndex: 2, emotion: "neutral", characterId: "deepseek" },
    { text: "开心的语气。", turnId: "turn-1", segmentIndex: 3, emotion: "happy", characterId: "deepseek" },
    { text: "另一个角色。", turnId: "turn-1", segmentIndex: 4, emotion: "happy", characterId: "serena" },
  ];

  assert.equal(takeQueuedSpeechBatch(first, queued), first);
  assert.deepEqual(queued.map((segment) => segment.segmentIndex), [1, 2, 3, 4]);
});

test("batches later queued clauses without crossing emotion or character boundaries", () => {
  const first = { text: "继续解释当前的事情，", turnId: "turn-1", segmentIndex: 1, emotion: "neutral", characterId: "deepseek" };
  const queued = [
    { text: "并且补充必要的背景，", turnId: "turn-1", segmentIndex: 2, emotion: "neutral", characterId: "deepseek" },
    { text: "让大家理解来龙去脉。", turnId: "turn-1", segmentIndex: 3, emotion: "neutral", characterId: "deepseek" },
    { text: "开心的语气。", turnId: "turn-1", segmentIndex: 4, emotion: "happy", characterId: "deepseek" },
    { text: "另一个角色。", turnId: "turn-1", segmentIndex: 5, emotion: "happy", characterId: "serena" },
  ];

  const batch = takeQueuedSpeechBatch(first, queued);

  assert.equal(batch.text, "继续解释当前的事情，并且补充必要的背景，让大家理解来龙去脉。");
  assert.deepEqual(batch.sourceSegmentIndices, [1, 2, 3]);
  assert.deepEqual(queued.map((segment) => segment.segmentIndex), [4, 5]);
});

test("keeps an early comma clause separate from queued follow-up text", () => {
  const first = { text: "第一句内容已经足够完整，", turnId: "turn-3", segmentIndex: 0, emotion: "neutral", characterId: "deepseek" };
  const queued = [
    { text: "而且表达了清楚的意思。", turnId: "turn-3", segmentIndex: 1, emotion: "neutral", characterId: "deepseek" },
  ];

  assert.equal(takeQueuedSpeechBatch(first, queued), first);
  assert.equal(queued.length, 1);
});

test("keeps a batch within the TTS request length while leaving remaining sentences queued", () => {
  const first = { text: "首句。", turnId: "turn-2", segmentIndex: 1, emotion: "neutral", characterId: "deepseek" };
  const queued = [
    { text: "第二句。", turnId: "turn-2", segmentIndex: 2, emotion: "neutral", characterId: "deepseek" },
    { text: "第三句。", turnId: "turn-2", segmentIndex: 3, emotion: "neutral", characterId: "deepseek" },
  ];

  const batch = takeQueuedSpeechBatch(first, queued, 8);

  assert.equal(batch.text, "首句。第二句。");
  assert.deepEqual(queued.map((segment) => segment.segmentIndex), [3]);
});
