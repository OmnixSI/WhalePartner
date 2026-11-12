import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { planUpgrade, readSeenLevel, resetSeenMemory, seenKey, writeSeenLevel } from "../src/card-preview/tier/seen-level.ts";

function fakeStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
}
const brokenStore = {
  getItem: () => { throw new Error("denied"); },
  setItem: () => { throw new Error("denied"); },
};

beforeEach(resetSeenMemory);

test("key is per character", () => {
  assert.equal(seenKey("whale"), "wp.cardSeenLevel.whale");
  assert.notEqual(seenKey("whale"), seenKey("deepseek"));
});

test("first time (no record): record the current level, do not play", () => {
  assert.deepEqual(planUpgrade(null, 3), { from: undefined, record: 3 });
});

test("a higher level than seen plays seen→current and records nothing yet", () => {
  assert.deepEqual(planUpgrade(3, 4), { from: 3, record: null });
  assert.deepEqual(planUpgrade(1, 5), { from: 1, record: null });
});

test("same level: nothing to play, nothing to write", () => {
  assert.deepEqual(planUpgrade(4, 4), { from: undefined, record: null });
});

test("a lower level than seen (data reset) aligns the record without playing", () => {
  assert.deepEqual(planUpgrade(5, 2), { from: undefined, record: 2 });
});

test("read ignores garbage and out-of-range values", () => {
  for (const raw of ["", "0", "6", "3.5", "abc", "-1", "03"]) {
    assert.equal(readSeenLevel("whale", fakeStore({ [seenKey("whale")]: raw })), null, raw);
  }
  assert.equal(readSeenLevel("whale", fakeStore({ [seenKey("whale")]: "4" })), 4);
});

test("write then read round-trips per character without touching others", () => {
  const store = fakeStore();
  writeSeenLevel("whale", 4, store);
  assert.equal(readSeenLevel("whale", store), 4);
  assert.equal(readSeenLevel("deepseek", store), null);
});

test("when storage is unavailable the level is kept in memory so the same upgrade is not replayed", () => {
  assert.equal(readSeenLevel("whale", brokenStore), null);
  writeSeenLevel("whale", 4, brokenStore);
  assert.equal(readSeenLevel("whale", brokenStore), 4);
  assert.deepEqual(planUpgrade(readSeenLevel("whale", brokenStore), 4), { from: undefined, record: null });
});

test("memory fallback does not shadow a working store", () => {
  const store = fakeStore();
  writeSeenLevel("whale", 2, brokenStore);
  writeSeenLevel("whale", 3, store);
  assert.equal(readSeenLevel("whale", store), 3);
});
