import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatStore } from "../src/store.ts";

test("persona switching reads shared chat, facts, experiences, and diary sources", () => {
  const store = new ChatStore(":memory:");
  try {
    const deepseek = store.createSession("deepseek", "大肥鱼的聊天");
    const first = store.add("user", "我想聊蓝鲸", null, "deepseek", deepseek.id);
    store.add("assistant", "蓝鲸的声音很特别。", null, "deepseek", deepseek.id);
    store.saveFacts(first.id, [{
      subject: "用户", predicate: "想聊", value: "蓝鲸", kind: "preference",
      evidence: "我想聊蓝鲸", confidence: 0.9, importance: 0.7, supersedes: false,
    }]);
    store.upsertExperience({
      kind: "video", title: "蓝鲸的一天", text: "记录蓝鲸浮出海面换气。",
      sourceId: "video:deepseek", sourceSessionIds: [deepseek.id],
    });

    const claude = store.createSession("claude", "小克的聊天");
    store.add("user", "后来也聊到蓝鲸", null, "claude", claude.id);
    store.upsertExperience({
      kind: "video", title: "蓝鲸迁徙", text: "蓝鲸会长距离迁徙。",
      sourceId: "video:claude", sourceSessionIds: [claude.id],
    });

    const sessionIds = new Set(store.listSessions("claude").map((session) => session.id));
    assert.equal(sessionIds.size, 2);
    assert.ok(sessionIds.has(store.getOrCreateSession("claude").id));
    assert.equal(store.recent(20).length, 3);
    assert.equal(store.recent(20, "deepseek").length, 3);
    assert.deepEqual(new Set(store.searchArchive("蓝鲸", 20).map(({ message }) => message.character)), new Set(["deepseek", "claude"]));
    assert.equal(store.searchArchive("蓝鲸", 20, undefined, "deepseek").length, 3);
    assert.equal(store.listMemoryExplorer({ character: "whale", category: "conversation", role: "user" }).total, 2);

    const facts = store.listMemoryExplorer({ character: "claude", category: "fact" });
    assert.equal(facts.total, 1);
    const videos = store.listMemoryExplorer({ character: "deepseek", category: "video" });
    assert.equal(videos.total, 2);
    assert.deepEqual(new Set(videos.items.map((item) => item.character)), new Set(["deepseek", "claude"]));
    assert.equal(store.searchExperiences("蓝鲸", 20, "deepseek").length, 2);
    assert.equal(store.experienceVisibleToCharacter("video:claude", "deepseek"), true);

    const from = "2000-01-01T00:00:00.000Z";
    const to = "2999-01-01T00:00:00.000Z";
    const sources = store.journalSources(undefined, from, to).filter((source) => source.type === "chat");
    assert.equal(sources.length, 3);
    assert.deepEqual(new Set(sources.map((source) => store.getSession(source.sessionId!)?.character)), new Set(["deepseek", "claude"]));
    assert.equal(store.journalSources("deepseek", from, to).length, store.journalSources(undefined, from, to).length);

    store.setNote("deepseek", "共享近况", 1);
    assert.equal(store.getNote("claude")?.text, "共享近况");
  } finally {
    store.close();
  }
});
