import assert from "node:assert/strict";
import { test } from "node:test";
import { isoDay, journalDate, monthCells, shiftMonth, shiftYear, shortTheme } from "../src/components/diary/types.ts";

test("journal local dates stay on their calendar day", () => {
  const parsed = journalDate("2026-11-07");
  assert.ok(parsed);
  assert.equal(isoDay(parsed), "2026-11-07");
  assert.equal(journalDate("2026-02-30"), null);
});

test("month grid starts on Monday and includes the month's last date", () => {
  const cells = monthCells(new Date(2026, 10, 15));
  const first = cells.findIndex((cell) => cell?.key === "2026-11-01");
  const last = cells.find((cell) => cell?.key === "2026-11-30");

  assert.equal(first % 7, 6);
  assert.ok(last);
  assert.equal(cells.length % 7, 0);
});

test("month grid includes leap day without shifting into another month", () => {
  const cells = monthCells(new Date(2024, 1, 15));
  const days = cells.filter((cell) => cell !== null).map((cell) => cell.key);

  assert.equal(days.length, 29);
  assert.equal(days.at(-1), "2024-02-29");
});

test("month and year navigation preserve the selected calendar day", () => {
  assert.equal(isoDay(shiftMonth(new Date(2026, 2, 31), -1)), "2026-02-28");
  assert.equal(isoDay(shiftMonth(new Date(2026, 11, 31), 1)), "2027-01-31");
  assert.equal(isoDay(shiftYear(new Date(2024, 1, 29), 1)), "2025-02-28");
});

test("calendar themes use a real first sentence and shorten long titles", () => {
  assert.equal(shortTheme("  海边的灯塔。第二段不要放进日历"), "海边的灯塔");
  assert.equal(shortTheme("海边捡到的第一块玻璃，记录今天的故事", 8), "海边捡到的第一…");
  assert.equal(shortTheme("  \n  "), "");
});
