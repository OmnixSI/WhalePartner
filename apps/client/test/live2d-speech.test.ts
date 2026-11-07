import assert from "node:assert/strict";
import { test } from "node:test";
import { addedBodyCharacters, speechDurationMs, visibleBodyCharacterCount } from "../src/avatar/live2d/speech.ts";

test("speech duration is 100 ms per visible body character", () => {
  assert.equal(speechDurationMs(10), 1_000);
  assert.equal(speechDurationMs(20), 2_000);
  assert.equal(speechDurationMs(7), 700);
});

test("visible speech excludes whitespace, Markdown controls, and emotion tags", () => {
  assert.equal(visibleBodyCharacterCount(" [emotion:happy] **鲸鱼**\n[海边](https://example.test) "), 4);
  assert.equal(visibleBodyCharacterCount("你好 [emotion:ha"), 2);
});

test("stream chunks add only newly visible characters", () => {
  const chunks = ["一二三四五", "六七八九十", "十一十二十三十四十五"];
  let previous = "";
  let counted = 0;
  for (const chunk of chunks) {
    const next = previous + chunk;
    counted += addedBodyCharacters(previous, next);
    previous = next;
  }
  assert.equal(counted, 20);
  assert.equal(speechDurationMs(counted), 2_000);
});
