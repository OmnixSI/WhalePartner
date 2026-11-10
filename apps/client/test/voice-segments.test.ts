import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeechSegment } from "../src/components/chat/voice-segments.ts";

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
