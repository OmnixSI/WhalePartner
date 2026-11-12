import assert from "node:assert/strict";
import { test } from "node:test";
import { canForget, groupOf, isSuperseded, type MemoryEntryP2 } from "../src/components/memory/types.ts";

test("reflection entries land in 她的近况 and cannot be forgotten one by one", () => {
  const current: MemoryEntryP2 = { id: "note:2", kind: "experience", text: "现在的心情", source: "reflection", status: "active" };
  const older: MemoryEntryP2 = { id: "note:1", kind: "experience", text: "以前的心情", source: "reflection", status: "superseded" };
  const observation: MemoryEntryP2 = { id: "observation:s1", kind: "experience", text: "会话观察", source: "reflection" };
  const fact: MemoryEntryP2 = { id: "local:1", kind: "fact", text: "用户养猫", source: "chat" };
  for (const entry of [current, older, observation]) {
    assert.equal(groupOf(entry), "now");
    assert.equal(canForget(entry), false);
  }
  assert.equal(isSuperseded(older), true);
  assert.equal(isSuperseded(current), false);
  assert.equal(canForget(fact), true);
});
