import type { ChatDeps } from "./chat.ts";
import { CHARACTERS, type CharacterId } from "./persona/persona.ts";
import { learnFrom } from "./learning.ts";
import { reflect } from "./reflect.ts";

let backgroundQueue: Promise<unknown> = Promise.resolve();
let backgroundPauseCount = 0;
const deferredBackgroundJobs: Array<{ label: string; task: () => Promise<void> }> = [];

function enqueueBackground(label: string, task: () => Promise<void>) {
  const debug = process.env.WP_DEBUG ? (message: string) => console.log(`[后台] ${label} ${message}`) : () => {};
  backgroundQueue = backgroundQueue.then(async () => {
    debug("开始");
    await task();
    debug("完成");
  }).catch((error: unknown) => {
    console.warn(`${label}失败：`, error instanceof Error ? error.message : error);
  });
}

function queueBackground(label: string, task: () => Promise<void>) {
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
  const countAtQueue = store.countAssistant(character);
  const previousAtQueue = store.getNote(character);
  if (!force && countAtQueue - (previousAtQueue?.assistantCount ?? 0) < REFLECT_EVERY) return;
  queueBackground("写近况小记", async () => {
    const sourceMessages = store.recent(14, character);
    if (sourceMessages.length === 0) return;
    const count = store.countAssistant(character);
    const previous = store.getNote(character);
    if (!force && count - (previous?.assistantCount ?? 0) < REFLECT_EVERY) return;
    if (!force) {
      const mine = sourceMessages.filter((message) => message.role === "user");
      if (mine.length >= 4) {
        await learnFrom(
          { provider, memory, store },
          { title: "用户最近的说法", text: mine.map((message) => message.content.slice(0, 160)).join("\n") },
          `chat:${character}:${count}`,
          undefined,
          [...new Set(mine.map((message) => message.sessionId))],
        );
      }
    }
    const learned = memory
      ? (await memory.recentLearnings(4, character).catch(() => [])).map((entry) => entry.text)
      : store.recentExperiences(100, false, character).filter((entry) => entry.kind === "learned").slice(0, 4).map((entry) => entry.text);
    const chat = sourceMessages.map((message) => `${message.role === "user" ? "用户" : "她"}：${message.content.slice(0, 160)}`);
    const note = await reflect(provider, { name: CHARACTERS[character].name, previous: previous?.text, learned, chat });
    if (note && sourceMessages.every((message) => store.message(message.id))) store.setNote(character, note, count);
  });
}

export function queueLearning(deps: ChatDeps, character: CharacterId, material: { title: string; text: string }, key: string, sourceSessionIds: string[] = []) {
  queueBackground("整理学到的东西", async () => {
    const survivingSessionIds = sourceSessionIds.filter((id) => deps.store.getSession(id, character));
    if (sourceSessionIds.length > 0 && survivingSessionIds.length === 0) return;
    const learned = await learnFrom({ provider: deps.provider, memory: deps.memory, store: deps.store }, material, key, undefined, survivingSessionIds);
    if (learned.length > 0) queueReflection(deps, character, true);
  });
}
