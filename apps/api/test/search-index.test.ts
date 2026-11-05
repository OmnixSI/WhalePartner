import assert from "node:assert/strict";
import { test } from "node:test";
import { openChatDatabase } from "../src/store/database.ts";
import { rebuildSearchIndexes } from "../src/store/search-index.ts";
import { SessionRepository } from "../src/store/sessions.ts";

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
