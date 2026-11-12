import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { announceUpgrade, notifiedKey, planUpgrade, readNotifiedLevel, readSeenLevel, resetSeenMemory, seenKey, shouldAnnounceUpgrade, writeNotifiedLevel, writeSeenLevel } from "../src/card-preview/tier/seen-level.ts";

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

/** getItem 正常、setItem 抛错（配额满、隐私模式只读）：storage 里还躺着旧值。 */
function readOnlyStore(initial: Record<string, string>) {
  return {
    getItem: (k: string) => initial[k] ?? null,
    setItem: () => { throw new Error("QuotaExceededError"); },
  };
}

test("setItem throws while getItem works: the same level is not replayed on every open (3→4 played once)", () => {
  const store = readOnlyStore({ [seenKey("whale")]: "3" });
  assert.deepEqual(planUpgrade(readSeenLevel("whale", store), 4), { from: 3, record: null }); // 第一次：播 3→4
  writeSeenLevel("whale", 4, store); // 播完记 4，但写不进去
  assert.equal(readSeenLevel("whale", store), 4); // 不能读回 storage 里的旧值 3
  assert.deepEqual(planUpgrade(readSeenLevel("whale", store), 4), { from: undefined, record: null }); // 再开不重播
});

test("only the key that failed to save reads from memory; a later successful write clears the mark", () => {
  const store = fakeStore({ [seenKey("whale")]: "3", [seenKey("claude")]: "2" });
  const failing = { getItem: store.getItem, setItem: () => { throw new Error("denied"); } };
  writeSeenLevel("whale", 4, failing);
  assert.equal(readSeenLevel("whale", store), 4); // 失败过的键读内存
  assert.equal(readSeenLevel("claude", store), 2); // 其余键照常读 storage
  writeSeenLevel("whale", 5, store); // 这次写成功
  assert.equal(store.data[seenKey("whale")], "5");
  store.data[seenKey("whale")] = "1"; // 标记已清：之后以 storage 为准
  assert.equal(readSeenLevel("whale", store), 1);
});

test("notified level is a separate record with the same failure fallback", () => {
  assert.notEqual(notifiedKey("whale"), seenKey("whale"));
  const store = readOnlyStore({});
  writeNotifiedLevel("whale", 4, store);
  assert.equal(readNotifiedLevel("whale", store), 4);
  assert.equal(readSeenLevel("whale", store), null); // 提示不碰「上次看到的等级」
});

test("announce: only for an unseen upgrade whose level was not announced yet", () => {
  assert.equal(shouldAnnounceUpgrade(3, null, 4), true);
  assert.equal(shouldAnnounceUpgrade(3, 4, 4), false); // 同一档只提示一次
  assert.equal(shouldAnnounceUpgrade(3, 4, 5), true); // 再升一档可以再提示
  assert.equal(shouldAnnounceUpgrade(4, null, 4), false); // 没升
  assert.equal(shouldAnnounceUpgrade(null, null, 4), false); // 没有记录：只对齐，不提示
  assert.equal(shouldAnnounceUpgrade(5, null, 2), false); // 等级变低
});

test("announceUpgrade: a crossed tier is announced once, and never touches the seen level", () => {
  const store = fakeStore({ [seenKey("whale")]: "3" });
  assert.equal(announceUpgrade("whale", 3, store), null); // 没升
  assert.equal(announceUpgrade("whale", 4, store), 4); // 跨档：提示
  assert.equal(announceUpgrade("whale", 4, store), null); // 同一档只提示一次
  assert.equal(store.data[seenKey("whale")], "3"); // 提示不改「上次看到的等级」
  assert.equal(announceUpgrade("whale", 5, store), 5); // 再升一档可以再提示
});

test("announceUpgrade: no seen record yet only aligns it (first time never announces)", () => {
  const store = fakeStore();
  assert.equal(announceUpgrade("whale", 4, store), null);
  assert.equal(store.data[seenKey("whale")], "4");
  assert.equal(announceUpgrade("whale", 5, store), 5);
});

test("announceUpgrade: once settings has played the upgrade (seen caught up) there is nothing to announce", () => {
  const store = fakeStore({ [seenKey("whale")]: "3" });
  assert.equal(announceUpgrade("whale", 4, store), 4);
  writeSeenLevel("whale", 4, store); // 设置页播完
  assert.equal(announceUpgrade("whale", 4, store), null);
});
