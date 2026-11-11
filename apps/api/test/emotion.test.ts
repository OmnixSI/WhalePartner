import assert from "node:assert/strict";
import { test } from "node:test";
import { splitEmotionTags, stripEmotionTags, EmotionFilter } from "../src/chat/emotion.ts";

test("整段剥离：开头、中间、结尾的标签都算", () => {
  assert.deepEqual(splitEmotionTags("[emotion:happy]今天真好"), { text: "今天真好", emotions: ["happy"] });
  assert.deepEqual(splitEmotionTags("今天[emotion:sad]有点累"), { text: "今天有点累", emotions: ["sad"] });
  assert.deepEqual(splitEmotionTags("哈哈[emotion:relaxed]"), { text: "哈哈", emotions: ["relaxed"] });
  assert.deepEqual(splitEmotionTags("[ emotion : angry ] 烦"), { text: "烦", emotions: ["angry"] });
});

test("不认识的词只剥标签、不收情绪", () => {
  assert.deepEqual(splitEmotionTags("[emotion:zzz]嗯"), { text: "嗯", emotions: [] });
});

test("没有标签时原样返回", () => {
  assert.equal(stripEmotionTags("普通的一句话。"), "普通的一句话。");
});

test("流式过滤器仍然把正文吐干净", () => {
  const filter = new EmotionFilter();
  const parts = ["[emoti", "on:hap", "py]你", "好"];
  let text = "";
  const emotions: string[] = [];
  for (const part of parts) {
    const result = filter.feed(part);
    text += result.text;
    emotions.push(...result.emotions);
  }
  text += filter.flush();
  assert.equal(text, "你好");
  assert.deepEqual(emotions, ["happy"]);
});
