import assert from "node:assert/strict";
import { test } from "node:test";
import { DiaryStore } from "../src/diary-store.ts";
import { inferMoodWeather } from "../src/diary-service.ts";
import type { ChatProvider } from "../src/llm/types.ts";

/** B3：心情 / 天气的落库与解析。 */

function jsonProvider(reply: string): ChatProvider {
  return {
    id: "fake",
    model: "fake-model",
    async *stream() {
      yield { text: reply } as never;
    },
  } as unknown as ChatProvider;
}

test("diary keeps mood and weather, and旧库自动补列", () => {
  const store = new DiaryStore(":memory:");
  const { item } = store.enqueue("https://www.bilibili.com/video/BV1xx411c7mD");
  store.saveDiary(item.id, "今天的浪很轻。", "calm", "sunny");
  const saved = store.get(item.id)!;
  assert.equal(saved.mood, "calm");
  assert.equal(saved.weather, "sunny");

  // 只给文本时不能把已有值抹掉（COALESCE）。
  store.saveDiary(item.id, "补一句。", null, null);
  const again = store.get(item.id)!;
  assert.equal(again.mood, "calm");
  assert.equal(again.weather, "sunny");
  store.close();
});

test("mood inference keeps only whitelisted values and fails soft", async () => {
  const ok = await inferMoodWeather(jsonProvider('{"mood":"cozy","weather":"rain"}'), "海边下雨，我煮了茶。");
  assert.deepEqual(ok, { mood: "cozy", weather: "rain" });

  const bad = await inferMoodWeather(jsonProvider('{"mood":"furious","weather":"lava"}'), "……");
  assert.deepEqual(bad, { mood: null, weather: null });

  const broken = await inferMoodWeather(jsonProvider("我看不懂这段日记。"), "……");
  assert.deepEqual(broken, { mood: null, weather: null });
});
