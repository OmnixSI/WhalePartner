import { CronJob } from "cron";
import type { DailyJournalService } from "./daily-journal.ts";

export function startDailyJournalScheduler(expression: string, journal: DailyJournalService): () => void {
  const job = CronJob.from({
    cronTime: expression,
    onTick: () => { void journal.generateTodayForAll(); },
    start: false,
    waitForCompletion: true,
    name: "whalepartner-daily-journal",
    errorHandler: (error) => console.warn("综合日记生成失败：", error instanceof Error ? error.message : error),
  });
  const today = localDate(new Date());
  const nextRunDate = localDate(job.nextDate().toJSDate());
  job.start();
  if (nextRunDate !== today) void journal.generateTodayForAll();
  return () => { void job.stop(); };
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
