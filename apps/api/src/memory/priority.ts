let foregroundChats = 0;
const memoryJobs = new Set<AbortController>();
const otherBackgroundJobs = new Set<AbortController>();
const idleWaiters = new Set<() => void>();

export function beginForegroundChat() {
  foregroundChats += 1;
  for (const job of memoryJobs) job.abort(new Error("前台聊天开始，暂停记忆整理。"));
  for (const job of otherBackgroundJobs) job.abort(new Error("前台聊天开始，暂停后台整理。"));
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    foregroundChats = Math.max(0, foregroundChats - 1);
    if (foregroundChats === 0) {
      for (const wake of idleWaiters) wake();
      idleWaiters.clear();
    }
  };
}

export function beginMemoryJob(): AbortController | undefined {
  if (foregroundChats > 0) return undefined;
  const controller = new AbortController();
  memoryJobs.add(controller);
  return controller;
}

export function endMemoryJob(controller: AbortController) {
  memoryJobs.delete(controller);
}

export function beginOtherBackgroundJob() {
  if (foregroundChats > 0) return undefined;
  const controller = new AbortController();
  otherBackgroundJobs.add(controller);
  return controller;
}

export function endOtherBackgroundJob(controller: AbortController) {
  otherBackgroundJobs.delete(controller);
}

export function waitForForegroundChatIdle() {
  if (foregroundChats === 0) return Promise.resolve();
  return new Promise<void>((resolve) => idleWaiters.add(resolve));
}

export function isForegroundChatActive() {
  return foregroundChats > 0;
}
