import type { ChatDeps } from "./service.ts";
import { CHARACTERS, type CharacterId } from "../persona/persona.ts";
import { learnFrom } from "./learning.ts";
import { reflect } from "./reflect.ts";
import { beginOtherBackgroundJob, endOtherBackgroundJob, waitForForegroundChatIdle } from "../memory/priority.ts";

let backgroundQueue: Promise<unknown> = Promise.resolve();
let backgroundPauseCount = 0;
const deferredBackgroundJobs: Array<{ label: string; task: (signal: AbortSignal) => Promise<void> }> = [];

function enqueueBackground(label: string, task: (signal: AbortSignal) => Promise<void>) {
  const debug = process.env.WP_DEBUG ? (message: string) => console.log(`[后台] ${label} ${message}`) : () => {};
  backgroundQueue = backgroundQueue.then(async () => {
    await waitForForegroundChatIdle();
    const controller = beginOtherBackgroundJob();
    if (!controller) {
      enqueueBackground(label, task);
      return;
    }
    debug("开始");
    try {
      await task(controller.signal);
      debug("完成");
    } catch (error) {
      if (controller.signal.aborted) enqueueBackground(label, task);
      else throw error;
    } finally {
      endOtherBackgroundJob(controller);
    }
  }).catch((error: unknown) => {
    console.warn(`${label}失败：`, error instanceof Error ? error.message : error);
  });
}

function queueBackground(label: string, task: (signal: AbortSignal) => Promise<void>) {
  if (backgroundPauseCount > 0) {
    deferredBackgroundJobs.push({ label, task });
    return;
  }
  enqueueBackground(label, task);
}

export async function waitForBackgroundJobs() {
  for (;;) {
    const pending = backgroundQueue;
    await pending;
    if (pending === backgroundQueue) return;
  }
}

export async function pauseBackgroundJobs() {
  backgroundPauseCount += 1;
  await waitForBackgroundJobs();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    backgroundPauseCount -= 1;
    if (backgroundPauseCount > 0) return;
    const jobs = deferredBackgroundJobs.splice(0);
    for (const job of jobs) enqueueBackground(job.label, job.task);
  };
}

const REFLECT_EVERY = 12;

export function queueReflection(deps: ChatDeps, character: CharacterId, force: boolean) {
  const { provider, store, memory } = deps;
  const countAtQueue = store.countAssistant();
  const previousAtQueue = store.getNote(character);
  if (!force && countAtQueue - (previousAtQueue?.assistantCount ?? 0) < REFLECT_EVERY) return;
  queueBackground("写近况小记", async (signal) => {
    const sourceMessages = store.recent(14);
    if (sourceMessages.length === 0) return;
    const count = store.countAssistant();
    const previous = store.getNote(character);
    if (!force && count - (previous?.assistantCount ?? 0) < REFLECT_EVERY) return;
    if (!force) {
      const mine = sourceMessages.filter((message) => message.role === "user");
      if (mine.length >= 4) {
        await learnFrom(
          { provider, memory, store },
          { title: "用户最近的说法", text: mine.map((message) => message.content.slice(0, 160)).join("\n") },
          `chat:${character}:${count}`,
          signal,
          [...new Set(mine.map((message) => message.sessionId))],
        );
      }
    }
    let learned = store.recentLearnings(4).map((entry) => entry.text);
    if (learned.length === 0 && memory) {
      learned = (await memory.recentLearnings(4).catch(() => [])).map((entry) => entry.text);
    }
    const chat = sourceMessages.map((message) => `${message.role === "user" ? "用户" : "她"}：${message.content.slice(0, 160)}`);
    const note = await reflect(provider, { name: CHARACTERS[character].name, previous: previous?.text, learned, chat }, signal);
    signal.throwIfAborted();
    if (note && sourceMessages.every((message) => store.message(message.id))) store.setNote(character, note, count);
  });
}

export function queueLearning(deps: ChatDeps, character: CharacterId, material: { title: string; text: string }, key: string, sourceSessionIds: string[] = []) {
  queueBackground("整理学到的东西", async (signal) => {
    const survivingSessionIds = sourceSessionIds.filter((id) => deps.store.getSession(id));
    if (sourceSessionIds.length > 0 && survivingSessionIds.length === 0) return;
    const learned = await learnFrom({ provider: deps.provider, memory: deps.memory, store: deps.store }, material, key, signal, survivingSessionIds);
    if (learned.length > 0) queueReflection(deps, character, true);
  });
}
