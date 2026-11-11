import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeechSegment, MAX_SPEECH_CHARS, splitSpeechText } from "../src/components/chat/voice-segments.ts";

test("keeps a complete multi-sentence answer in one speech segment", () => {
  const answer = "第一句话已经说明了主要内容。第二句话补充必要信息，最后再做个简短总结。";

  assert.deepEqual(createSpeechSegment(answer, "turn-1", 0, "neutral", "deepseek"), {
    text: answer,
    turnId: "turn-1",
    segmentIndex: 0,
    emotion: "neutral",
    characterId: "deepseek",
  });
});

test("does not create a speech request for an empty answer", () => {
  assert.equal(createSpeechSegment("  \n ", "turn-1", 0, "neutral", "deepseek"), null);
});

test("a normal-length answer still goes to TTS as one request", () => {
  const answer = "第一句话已经说明了主要内容。第二句话补充必要信息，最后再做个简短总结。";
  assert.deepEqual(splitSpeechText(`  ${answer}\n`), [answer]);
  const exact = "好".repeat(MAX_SPEECH_CHARS);
  assert.deepEqual(splitSpeechText(exact), [exact]);
  assert.deepEqual(splitSpeechText(" \n "), []);
});

test("an answer over the server limit is split on sentence ends, each segment within the limit", () => {
  const sentence = "这是一句用来凑长度的完整句子，里面有逗号也有句号。";
  const answer = sentence.repeat(Math.ceil((MAX_SPEECH_CHARS * 2.5) / sentence.length));
  assert.ok(answer.length > MAX_SPEECH_CHARS * 2);

  const segments = splitSpeechText(answer);
  assert.ok(segments.length >= 3);
  for (const segment of segments) {
    assert.ok(segment.length <= MAX_SPEECH_CHARS, `segment too long: ${segment.length}`);
    assert.ok(segment.endsWith("。"), "segments end on a sentence boundary");
  }
  assert.equal(segments.join(""), answer);
});

test("closing quotes stay with their sentence and nothing is lost between segments", () => {
  const answer = "她说：“今天的海很安静。”我点点头。".repeat(80);
  const segments = splitSpeechText(answer, 100);
  for (const segment of segments) {
    assert.ok(segment.length <= 100);
    assert.ok(/[。”]$/u.test(segment));
  }
  assert.equal(segments.join(""), answer);
});

test("a single over-long sentence is cut at pauses, or hard-cut without splitting an emoji", () => {
  const clauses = "海浪一阵一阵地拍上来，".repeat(30);
  const soft = splitSpeechText(clauses, 100);
  assert.ok(soft.length > 1);
  for (const piece of soft.slice(0, -1)) {
    assert.ok(piece.length <= 100);
    assert.ok(piece.endsWith("，"), "prefers cutting after a comma");
  }
  assert.equal(soft.join(""), clauses);

  const emoji = "🐳".repeat(80);
  const hard = splitSpeechText(emoji, 101);
  for (const piece of hard) {
    assert.ok(piece.length <= 101);
    assert.ok(!/[\ud800-\udbff]$/u.test(piece) && !/^[\udc00-\udfff]/u.test(piece), "no broken surrogate pair");
  }
  assert.equal(hard.join(""), emoji);
});
