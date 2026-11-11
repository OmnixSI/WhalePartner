import { CronJob } from "cron";
import type { DiaryService } from "./service.ts";

/** 在 API 进程内启动一次定时任务，返回服务关闭时调用的停止函数。 */
export function startDiaryScheduler(expression: string, diary: DiaryService): () => void {
  const job = CronJob.from({
    cronTime: expression,
    onTick: () => { diary.trigger(); },
    start: true,
    waitForCompletion: true,
    name: "whalepartner-diary",
    errorHandler: (error) => console.warn("定时日记任务失败：", error instanceof Error ? error.message : error),
  });
  return () => { void job.stop(); };
}
