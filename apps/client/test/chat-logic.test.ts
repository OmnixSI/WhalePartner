import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyHttp, classifyStreamError, describeChatFailure } from "../src/lib/chat-errors.ts";
import { isSendKey } from "../src/lib/chat-prefs.ts";
import { sliceChunks, splitReply, typingGap } from "../src/lib/reply.ts";
import { stripEmotionTags, readEmotion } from "../src/lib/emotion.ts";

const key = (init: Partial<{ key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) => ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, ...init });

test("Enter sends, Shift+Enter breaks the line; mod-enter mode and touch need Cmd/Ctrl", () => {
  assert.equal(isSendKey(key(), "enter", false), true);
  assert.equal(isSendKey(key({ shiftKey: true }), "enter", false), false);
  assert.equal(isSendKey(key(), "mod-enter", false), false);
  assert.equal(isSendKey(key({ ctrlKey: true }), "mod-enter", false), true);
  assert.equal(isSendKey(key(), "enter", true), false);
  assert.equal(isSendKey(key({ metaKey: true }), "enter", true), true);
  assert.equal(isSendKey({ ...key(), key: "a" }, "enter", false), false);
});

test("splitReply gives 1-3 prefix-stable bubbles", () => {
  assert.deepEqual(splitReply("好呀。"), ["好呀。"]);
  const text = "今天天气特别好，我在窗边看了很久的云。你呢，今天有没有出门走一走？我有点想听你讲讲。晚上想吃什么，我陪你一起想。";
  const parts = splitReply(text);
  assert.ok(parts.length >= 2 && parts.length <= 3);
  assert.equal(parts.join(""), text);
  // 流式前缀稳定：已确定的边界不随后续文字移动
  for (let n = 10; n < text.length; n += 7) {
    const partial = splitReply(text.slice(0, n));
    for (let i = 0; i < partial.length - 1; i++) assert.equal(partial[i], parts[i]);
  }
  const long = Array.from({ length: 10 }, (_, i) => `这是很长的第${i}句话，要超过十八个字才行呢。`).join("");
  assert.equal(splitReply(long).length, 3);
});

test("typing gap and chunk slicing", () => {
  assert.equal(typingGap(""), 400);
  assert.equal(typingGap("字".repeat(100)), 900);
  assert.deepEqual(sliceChunks(["你好", "世界啊"], 1, 4), ["好", "世界"]);
});

test("errors are readable and classified", () => {
  assert.equal(classifyHttp(402, { error: "quota_exceeded", message: "贝壳用完了" }).code, "quota");
  assert.match(classifyHttp(402, { error: "quota_exceeded", message: "贝壳用完了" }).message, /贝壳/);
  assert.equal(classifyHttp(401, {}).code, "auth");
  assert.equal(classifyHttp(503, {}).code, "starting");
  assert.equal(classifyStreamError("x", "timeout").code, "timeout");
  assert.match(describeChatFailure("network"), /网络/);
});

test("client strips fuzzy and full-width emotion tags", () => {
  assert.equal(stripEmotionTags("【 Emotion ： happy 】嗨"), "嗨");
  assert.equal(readEmotion("[ emotion: sad ]唉").emotion, "sad");
});
