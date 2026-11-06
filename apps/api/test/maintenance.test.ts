import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatStore } from "../src/store.ts";

test("clearing chat keeps independent media and marks its deleted chat source", () => {
  const store = new ChatStore(":memory:");
  try {
    const session = store.createSession("whale", "一起看过的内容");
    const message = store.add("user", "看看这段蓝鲸视频", null, "whale", session.id);
    store.upsertExperience({
      kind: "video",
      title: "蓝鲸浮出海面",
      text: "视频记录了蓝鲸浮出海面呼吸的片段。",
      sourceId: "video:clear-history",
      sourceSessionId: session.id,
      sourceMessageId: message.id,
    });

    store.clear();

    const retained = store.experienceBySourceId("video:clear-history");
    assert.equal(retained?.text, "视频记录了蓝鲸浮出海面呼吸的片段。");
    assert.equal(retained?.sourceSessionId, null);
    assert.equal(retained?.sourceMessageId, null);
    assert.equal(retained?.sourceMissing, true);
    const listed = store.listMemoryExplorer({ character: "whale", category: "video" });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0]?.sourceMissing, true);
  } finally {
    store.close();
  }
});
