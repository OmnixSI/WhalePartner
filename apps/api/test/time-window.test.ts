import assert from "node:assert/strict";
import { test } from "node:test";
import { matchExpression, timeWindow } from "../src/store/search.ts";

const now = new Date(2026, 10, 11, 12, 0, 0);

test("a number that only looks like a year does not narrow recall to that year", () => {
  assert.equal(timeWindow("我花了2000块买了键盘", now), undefined);
  assert.equal(timeWindow("这首歌循环了 1999 次", now), undefined);
  assert.match(matchExpression("我花了2000块买了键盘") ?? "", /"20"/, "金额不是时间词，仍然留在检索词里");
});

test("explicit years and months still set the window", () => {
  const year = timeWindow("我2024年去了青岛", now);
  assert.equal(year?.from, new Date(2024, 0, 1).toISOString());
  assert.equal(year?.to, new Date(2025, 0, 1).toISOString());
  const spaced = timeWindow("2023 年的事你还记得吗", now);
  assert.equal(spaced?.from, new Date(2023, 0, 1).toISOString());
  const month = timeWindow("2025年3月我们聊过什么", now);
  assert.equal(month?.from, new Date(2025, 2, 1).toISOString());
  assert.equal(month?.to, new Date(2025, 3, 1).toISOString());
});
