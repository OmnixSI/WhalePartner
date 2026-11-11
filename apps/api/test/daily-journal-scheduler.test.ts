import assert from "node:assert/strict";
import { test } from "node:test";
import { startDailyJournalScheduler } from "../src/diary/journal-scheduler.ts";
import type { DailyJournalService } from "../src/diary/journal.ts";

test("startup catches up the scheduled local day and avoids a duplicate before today's next run", () => {
  let missedRuns = 0;
  const missed = startDailyJournalScheduler("0 0 1 1 *", {
    async generateTodayForAll() { missedRuns++; },
  } as unknown as DailyJournalService);
  assert.equal(missedRuns, 1);
  missed();

  let upcomingRuns = 0;
  const upcoming = startDailyJournalScheduler("* * * * *", {
    async generateTodayForAll() { upcomingRuns++; },
  } as unknown as DailyJournalService);
  assert.equal(upcomingRuns, 0);
  upcoming();
});

test("an overdue tick after sleeping past midnight writes the day its slot belonged to", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(2026, 10, 7, 20, 0, 0) });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const written: string[] = [];
  const stop = startDailyJournalScheduler("30 20 * * *", {
    async generateTodayForAll() { written.push("startup"); },
    async generateForAll(date: string) { written.push(date); },
  } as unknown as DailyJournalService);
  try {
    assert.deepEqual(written, [], "20:00 启动，今天 20:30 的槽位还没到，不用补写");
    // 20:00 合上电脑，第二天 08:00 才醒：20:30 那一趟这时才补跑，写的应该是 11 月 7 日。
    context.mock.timers.setTime(new Date(2026, 10, 8, 8, 0, 0).getTime());
    context.mock.timers.tick(1);
    await settle();
    assert.deepEqual(written, ["2026-11-07"]);
    // 当天 20:30 按时触发，写当天。
    context.mock.timers.tick(new Date(2026, 10, 8, 20, 30, 0).getTime() - Date.now());
    await settle();
    assert.deepEqual(written, ["2026-11-07", "2026-11-08"]);
  } finally {
    stop();
  }
});
