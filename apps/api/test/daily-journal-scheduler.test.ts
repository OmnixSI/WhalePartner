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
