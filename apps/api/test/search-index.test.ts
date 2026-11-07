import assert from "node:assert/strict";
import { test } from "node:test";
import { openChatDatabase } from "../src/store/database.ts";
import { rebuildSearchIndexes } from "../src/store/search-index.ts";
import { SessionRepository } from "../src/store/sessions.ts";
import { ChatStore } from "../src/store.ts";

test("startup repairs FTS rows and markers left out of sync", () => {
  const db = openChatDatabase(":memory:");
  try {
    rebuildSearchIndexes(db);
    const sessions = new SessionRepository(db);
    const session = sessions.createSession("whale");
    const message = sessions.add("user", "我们一起看过海豚纪录片", null, "whale", session.id);

    db.prepare("DELETE FROM message_search_indexed WHERE message_id = ?").run(message.id);
    assert.doesNotThrow(() => rebuildSearchIndexes(db));
    assert.equal(sessions.searchArchive("海豚", 5, undefined, "whale").length, 1);

    db.prepare("DELETE FROM message_search WHERE rowid = ?").run(message.id);
    assert.doesNotThrow(() => rebuildSearchIndexes(db));
    assert.equal(sessions.searchArchive("海豚", 5, undefined, "whale").length, 1);
  } finally {
    db.close();
  }
});

test("memory explorer searches paginated chat archive and returns source-backed categories", () => {
  const store = new ChatStore(":memory:");
  try {
    const session = store.createSession("whale", "海边那天");
    let firstMessage = 0;
    for (let index = 0; index < 600; index++) {
      const message = store.add("user", `第${index}次提到鲸鱼和海洋`, null, "whale", session.id);
      if (index === 0) firstMessage = message.id;
    }
    store.saveFacts(firstMessage, [{
      subject: "用户", predicate: "喜欢", value: "海洋", kind: "preference",
      evidence: "第0次提到鲸鱼和海洋", confidence: 0.9, importance: 0.8, supersedes: false,
    }]);
    store.upsertExperience({ kind: "video", title: "蓝鲸纪录片", text: "讲述海洋生活", sourceId: "BV-memory-explorer", sourceSessionId: session.id, sourceMessageId: firstMessage });
    store.saveObservation(session.id, "她记得这段对话中的海洋话题。", firstMessage, firstMessage);

    const result = store.listMemoryExplorer({ character: "whale", query: "鲸鱼", category: "conversation", role: "user", page: 20, pageSize: 30 });
    assert.equal(result.total, 600);
    assert.equal(result.items.length, 30);
    assert.equal(result.items[0].category, "conversation");
    assert.equal(result.items[0].role, "user");
    assert.equal(result.items[0].sessionId, session.id);
    assert.equal(result.counts.conversation, 600);
    const lastPage = store.add("user", "又提到了鲸鱼", null, "whale", session.id);
    const finalItem = store.listMemoryExplorer({ character: "whale", query: "鲸鱼", category: "conversation", role: "user", page: 21, pageSize: 30 });
    assert.equal(finalItem.total, 601);
    assert.equal(finalItem.items.length, 1);
    store.remove(lastPage.id);
    const deletedFinalPage = store.listMemoryExplorer({ character: "whale", query: "鲸鱼", category: "conversation", role: "user", page: 21, pageSize: 30 });
    assert.equal(deletedFinalPage.total, 600);
    assert.equal(deletedFinalPage.items.length, 0);
    assert.equal(store.listMemoryExplorer({ character: "whale", query: "鲸鱼", category: "conversation", role: "user", page: 20, pageSize: 30 }).items.length, 30);
    const all = store.listMemoryExplorer({ character: "whale" });
    assert.equal(all.counts.fact, 1);
    assert.equal(all.counts.video, 1);
    assert.equal(all.counts.reflection, 1);

    const historical = store.listMemoryExplorer({ character: "whale", category: "fact", status: "historical" });
    assert.equal(historical.total, 0);
    const video = store.listMemoryExplorer({ character: "whale", category: "video" });
    assert.equal(video.items[0].title, "蓝鲸纪录片");
    assert.equal(video.items[0].messageId, firstMessage);
    const historicalVideos = store.listMemoryExplorer({ character: "whale", category: "video", status: "historical" });
    assert.equal(historicalVideos.total, 1);
    assert.equal(historicalVideos.items[0].category, "video");

    const otherSession = store.createSession("claude", "小克也看过蓝鲸");
    const otherMessage = store.add("user", "我也给小克分享了蓝鲸纪录片", null, "claude", otherSession.id);
    store.upsertExperience({
      kind: "video",
      title: "蓝鲸纪录片",
      text: "讲述海洋生活",
      sourceId: "BV-memory-explorer",
      sourceSessionId: otherSession.id,
      sourceMessageId: otherMessage.id,
      sourceSessionIds: [session.id, otherSession.id],
    });
    const whaleVideo = store.listMemoryExplorer({ character: "whale", category: "video" }).items[0];
    const claudeVideo = store.listMemoryExplorer({ character: "claude", category: "video" }).items[0];
    assert.deepEqual(whaleVideo, claudeVideo);
    assert.deepEqual([whaleVideo.sessionId, whaleVideo.messageId], [otherSession.id, otherMessage.id]);
  } finally {
    store.close();
  }
});

test("recent learned material is shared across characters", () => {
  const store = new ChatStore(":memory:");
  try {
    const whale = store.createSession("whale", "鲸鱼分享");
    const claude = store.createSession("claude", "另一段分享");
    store.upsertExperience({
      kind: "learned", title: "聊天学习", text: "鲸鱼的声音传播很远。",
      sourceId: "learned:chat:whale:12:0", sourceSessionIds: [whale.id],
    });
    store.upsertExperience({
      kind: "learned", title: "视频学习", text: "鲸鱼会用声音交流。",
      sourceId: "learned:video:BV1WHALE:0", sourceSessionIds: [whale.id],
    });
    store.upsertExperience({
      kind: "learned", title: "另一角色学习", text: "海豚会使用回声定位。",
      sourceId: "learned:chat:claude:9:0", sourceSessionIds: [claude.id],
    });
    store.upsertExperience({
      kind: "learned", title: "公共学习", text: "潮汐受月球引力影响。",
      sourceId: "learned:video:global:0",
    });

    const whaleSources = store.recentLearnings(10, "whale").map((entry) => entry.sourceId);
    const claudeSources = store.recentLearnings(10, "claude").map((entry) => entry.sourceId);
    assert.ok(whaleSources.includes("learned:chat:whale:12:0"));
    assert.ok(whaleSources.includes("learned:video:BV1WHALE:0"));
    assert.ok(whaleSources.includes("learned:video:global:0"));
    assert.ok(whaleSources.includes("learned:chat:claude:9:0"));
    assert.ok(claudeSources.includes("learned:chat:claude:9:0"));
    assert.ok(claudeSources.includes("learned:video:global:0"));
    assert.ok(claudeSources.includes("learned:video:BV1WHALE:0"));
    assert.deepEqual(whaleSources, claudeSources);
  } finally {
    store.close();
  }
});
