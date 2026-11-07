import assert from "node:assert/strict";
import { test } from "node:test";
import { chatQuoteHref, dateRangeBounds, quoteText, timeOf, whenText } from "../src/lib/surf-view.ts";

test("「和她聊聊这个」把标题和链接放进 ?quote=，能原样还原", () => {
  const item = { title: "鲸歌是什么？", url: "https://example.com/a?b=1&c=2#x" };
  const href = chatQuoteHref(item);
  assert.ok(href.startsWith("/?quote="));
  const decoded = new URL(href, "http://localhost").searchParams.get("quote");
  assert.equal(decoded, quoteText(item));
  assert.match(decoded ?? "", /《鲸歌是什么？》/);
  assert.match(decoded ?? "", /https:\/\/example\.com\/a\?b=1&c=2#x/);
});

test("日期筛选：今天 / 近 7 天 / 近 30 天 / 选一天 换成本地零点的区间", () => {
  const now = new Date(2026, 10, 7, 15, 30);
  assert.deepEqual(dateRangeBounds("all", "", now), {});
  assert.equal(dateRangeBounds("today", "", now).from, new Date(2026, 10, 7).toISOString());
  assert.equal(dateRangeBounds("week", "", now).from, new Date(2026, 10, 1).toISOString());
  assert.equal(dateRangeBounds("month", "", now).from, new Date(2026, 9, 9).toISOString());
  assert.deepEqual(dateRangeBounds("day", "2026-11-05", now), {
    from: new Date(2026, 10, 5).toISOString(),
    to: new Date(2026, 10, 6).toISOString(),
  });
  assert.deepEqual(dateRangeBounds("day", "", now), {}, "没选日期就不限");
});

test("时间文案：今天 / 昨天 / 月日", () => {
  const now = new Date(2026, 10, 7, 16, 0);
  assert.equal(whenText(new Date(2026, 10, 7, 14, 20).toISOString(), now), "今天 14:20");
  assert.equal(whenText(new Date(2026, 10, 6, 9, 5).toISOString(), now), "昨天 09:05");
  assert.equal(whenText(new Date(2026, 10, 1, 18, 2).toISOString(), now), "11月1日 18:02");
  assert.equal(timeOf("not a date"), "");
});
