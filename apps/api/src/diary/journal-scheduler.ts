import { CronJob } from "cron";
import type { DailyJournalService } from "./journal.ts";

export function startDailyJournalScheduler(expression: string, journal: DailyJournalService): () => void {
  // 下一次计划执行属于哪一天。电脑睡过了计划时间、过了午夜才补跑这一趟时，写的仍是槽位那天，
  // 而不是刚开始、还空着的新一天（否则前一天的日记永远不会写）。
  let slotDate = "";
  const job = CronJob.from({
    cronTime: expression,
    onTick: async () => {
      const date = slotDate;
      slotDate = localDate(job.nextDate().toJSDate());
      await journal.generateForAll(date);
    },
    start: false,
    waitForCompletion: true,
    name: "whalepartner-daily-journal",
    errorHandler: (error) => console.warn("综合日记生成失败：", error instanceof Error ? error.message : error),
  });
  const today = localDate(new Date());
  slotDate = localDate(job.nextDate().toJSDate());
  job.start();
  if (slotDate !== today) void journal.generateTodayForAll();
  return () => { void job.stop(); };
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
