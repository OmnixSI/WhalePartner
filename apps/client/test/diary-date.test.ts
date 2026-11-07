import assert from "node:assert/strict";
import { test } from "node:test";
import { isoDay, journalDate } from "../src/components/diary/types.ts";

test("journal local dates stay on their calendar day", () => {
  const parsed = journalDate("2026-11-07");
  assert.ok(parsed);
  assert.equal(isoDay(parsed), "2026-11-07");
  assert.equal(journalDate("2026-02-30"), null);
});
