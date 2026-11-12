import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  canView, chooseViewLevel, clearViewLevel, readSeenLevel, readViewLevel, resetSeenMemory, resetViewMemory,
  resolveViewLevel, seenKey, unlockedLevels, viewKey, writeSeenLevel,
} from "../src/card-preview/tier/seen-level.ts";

function fakeStore(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  };
}

beforeEach(() => {
  resetViewMemory();
  resetSeenMemory();
});

test("only unlocked tiers (1…real level) can be chosen", () => {
  assert.deepEqual(unlockedLevels(3), [1, 2, 3]);
  assert.deepEqual(unlockedLevels(1), [1]);
  assert.deepEqual(unlockedLevels(9), [1, 2, 3, 4, 5]);
  for (const want of [1, 2, 3]) assert.equal(canView(3, want), true);
  for (const want of [0, 4, 5, 2.5, Number.NaN]) assert.equal(canView(3, want), false);

  const store = fakeStore();
  assert.equal(chooseViewLevel("deepseek", 3, 4, store), false, "Lv4 not unlocked at real Lv3");
  assert.equal(chooseViewLevel("deepseek", 3, 5, store), false);
  assert.equal(chooseViewLevel("deepseek", 3, 0, store), false);
  assert.deepEqual(store.data, {}, "a rejected choice writes nothing");
  assert.equal(resolveViewLevel(3, readViewLevel("deepseek", store)), 3);

  assert.equal(chooseViewLevel("deepseek", 3, 2, store), true);
  assert.equal(resolveViewLevel(3, readViewLevel("deepseek", store)), 2);
});

test("a stored choice above the real level (data reset) shows the real level", () => {
  const store = fakeStore({ [viewKey("deepseek")]: "4" });
  assert.equal(resolveViewLevel(2, readViewLevel("deepseek", store)), 2);
  assert.equal(resolveViewLevel(5, readViewLevel("deepseek", store)), 4);
});

test("switching the shown tier never touches the real level or the seen level", () => {
  const store = fakeStore();
  writeSeenLevel("deepseek", 4, store);
  const before = { ...store.data };
  const real = 4;
  assert.equal(chooseViewLevel("deepseek", real, 1, store), true);
  assert.equal(chooseViewLevel("deepseek", real, 3, store), true);
  assert.equal(real, 4);
  assert.equal(readSeenLevel("deepseek", store), 4);
  assert.equal(store.data[seenKey("deepseek")], before[seenKey("deepseek")]);
  // 只多了一条显示档位记录，别的键原样
  assert.deepEqual(Object.keys(store.data).sort(), [seenKey("deepseek"), viewKey("deepseek")].sort());
  // 选回真实等级：删掉记录，跟着真实等级
  assert.equal(chooseViewLevel("deepseek", real, 4, store), true);
  assert.equal(readViewLevel("deepseek", store), null);
  assert.deepEqual(store.data, before);
});

test("the choice survives a restart (fresh memory, same storage) and is per character", () => {
  const store = fakeStore();
  chooseViewLevel("deepseek", 5, 2, store);
  chooseViewLevel("claude", 4, 3, store);
  resetViewMemory(); // 重启：内存清空，只剩 localStorage
  assert.equal(store.data[viewKey("deepseek")], "2");
  assert.equal(resolveViewLevel(5, readViewLevel("deepseek", store)), 2);
  assert.equal(resolveViewLevel(4, readViewLevel("claude", store)), 3);
  assert.equal(resolveViewLevel(1, readViewLevel("gemini", store)), 1);
});

test("clearViewLevel (real upgrade) goes back to the top tier", () => {
  const store = fakeStore();
  chooseViewLevel("deepseek", 4, 2, store);
  clearViewLevel("deepseek", store);
  assert.equal(readViewLevel("deepseek", store), null);
  assert.equal(resolveViewLevel(5, readViewLevel("deepseek", store)), 5);
});

test("storage that throws keeps the choice in memory for this run", () => {
  const broken = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => { throw new Error("denied"); },
  };
  assert.equal(chooseViewLevel("deepseek", 4, 2, broken), true);
  assert.equal(readViewLevel("deepseek", broken), 2);
  clearViewLevel("deepseek", broken);
  assert.equal(readViewLevel("deepseek", broken), null);
});
