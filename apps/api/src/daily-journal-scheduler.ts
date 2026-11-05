import { CronJob } from "cron";
import type { DailyJournalService } from "./daily-journal.ts";

export function startDailyJournalScheduler(expression: string, journal: DailyJournalService): () => void {
  const job = CronJob.from({
    cronTime: expression,
    onTick: () => { void journal.generateTodayForAll(); },
    start: true,
    waitForCompletion: true,
    name: "whalepartner-daily-journal",
    errorHandler: (error) => console.warn("综合日记生成失败：", error instanceof Error ? error.message : error),
  });
  return () => { void job.stop(); };
}
