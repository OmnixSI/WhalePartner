import type { ChatDeps } from "./service.ts";
import { CHARACTERS, type CharacterId } from "../persona/persona.ts";
import { learnFrom } from "./learning.ts";
import { buildWeekChat, reflect, REFLECT_CHAT_BUDGET, REFLECT_WINDOW_DAYS } from "./reflect.ts";
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

/** 近况多久写一版。 */
export const REFLECT_INTERVAL_MS = 3 * 86_400_000;
/** 还没有近况的新用户，聊到这么多条回复就写第一版。 */
export const FIRST_NOTE_AFTER_REPLIES = 12;
/** 每多这么多条回复，从用户最近的说法里学一次。 */
export const LEARN_EVERY_REPLIES = 12;
/** 一次生成失败（模型出错或小记被过滤）后，至少隔这么久再试，免得每条回复都重试。 */
const REFLECT_RETRY_MS = 6 * 3_600_000;
let reflectionQueued = false;
let lastReflectionAttempt = 0;
let learningQueued = false;

/** 测试用：清掉进程内的排队和重试记录。 */
export function resetReflectionScheduleForTests() {
  reflectionQueued = false;
  lastReflectionAttempt = 0;
  learningQueued = false;
}

/**
 * 已有近况：距上一版满 3 天、且这期间有新聊天才到期。
 * 还没有近况（新用户，或清除聊天后）：累计满 12 条回复就写第一版。
 */
export function reflectionDue(state: { lastAt: string | null; hasNewChat: boolean; assistantCount: number | null }, now = Date.now()) {
  if (state.lastAt === null) return (state.assistantCount ?? 0) >= FIRST_NOTE_AFTER_REPLIES;
  return state.hasNewChat && now - Date.parse(state.lastAt) >= REFLECT_INTERVAL_MS;
}

/**
 * 启动时和每次回复之后调用：只做一条查询，到期才在后台排一次生成，不阻塞调用方。
 * 不用常驻定时器，因为 App 不会一直开着。
 */
export function queueReflectionIfDue(deps: ChatDeps, character: CharacterId) {
  if (reflectionQueued || Date.now() - lastReflectionAttempt < REFLECT_RETRY_MS) return;
  if (!reflectionDue(deps.store.reflectionState())) return;
  queueReflection(deps, character, false);
}

/** force：删除会话后按剩下的聊天重写一版，不看间隔。 */
export function queueReflection(deps: ChatDeps, character: CharacterId, force: boolean) {
  const { provider, store, memory } = deps;
  if (!force) reflectionQueued = true;
  queueBackground("写近况小记", async (signal) => {
    try {
      if (!force && !reflectionDue(store.reflectionState())) return;
      const since = new Date(Date.now() - REFLECT_WINDOW_DAYS * 86_400_000).toISOString();
      // 行数上限只是防止一周聊得特别多时一次读太多行；真正的长度由字数上限控制。
      const weekMessages = store.messagesSince(since, Math.ceil(REFLECT_CHAT_BUDGET / 4));
      if (weekMessages.length === 0) return;
      if (!force) lastReflectionAttempt = Date.now();
      const { chat, kept: sourceMessages, truncated } = buildWeekChat(weekMessages);
      const count = store.countAssistant();
      const previous = store.getNote(character);
      let learned = store.recentLearnings(4).map((entry) => entry.text);
      if (learned.length === 0 && memory) {
        learned = (await memory.recentLearnings(4).catch(() => [])).map((entry) => entry.text);
      }
      const note = await reflect(provider, { name: CHARACTERS[character].name, previous: previous?.text, learned, chat, truncated }, signal);
      signal.throwIfAborted();
      // assistant_count 只作记录（写这一版时一共有多少条回复），不决定何时重写。
      if (note && sourceMessages.every((message) => store.message(message.id))) store.setNote(character, note, count);
    } finally {
      if (!force) reflectionQueued = false;
    }
  });
}

/**
 * 每次回复之后调用：每多 12 条回复，在后台从用户最近 14 条消息里学一次。
 * 和近况分开，频率与改动前一样，也不会触发近况。
 */
export function queueChatLearningIfDue(deps: ChatDeps, character: CharacterId) {
  if (learningQueued) return;
  const { assistantCount, learnedAt } = deps.store.chatLearningState();
  // 删除会话或清除聊天后回复数会变少，进度跟着退回去，从那里重新数。
  if (assistantCount < learnedAt) deps.store.markChatLearned(assistantCount);
  if (assistantCount - Math.min(learnedAt, assistantCount) < LEARN_EVERY_REPLIES) return;
  learningQueued = true;
  queueBackground("从聊天里学东西", async (signal) => {
    try {
      const { assistantCount: count, learnedAt: last } = deps.store.chatLearningState();
      if (count - last < LEARN_EVERY_REPLIES) return;
      const mine = deps.store.recent(14).filter((message) => message.role === "user");
      if (mine.length >= 4) {
        await learnFrom(
          { provider: deps.provider, memory: deps.memory, store: deps.store },
          { title: "用户最近的说法", text: mine.map((message) => message.content.slice(0, 160)).join("\n") },
          `chat:${character}:${count}`,
          signal,
          [...new Set(mine.map((message) => message.sessionId))],
        );
      }
      signal.throwIfAborted();
      deps.store.markChatLearned(count);
    } finally {
      learningQueued = false;
    }
  });
}

export function queueLearning(deps: ChatDeps, character: CharacterId, material: { title: string; text: string }, key: string, sourceSessionIds: string[] = []) {
  queueBackground("整理学到的东西", async (signal) => {
    const survivingSessionIds = sourceSessionIds.filter((id) => deps.store.getSession(id));
    if (sourceSessionIds.length > 0 && survivingSessionIds.length === 0) return;
    await learnFrom({ provider: deps.provider, memory: deps.memory, store: deps.store }, material, key, signal, survivingSessionIds);
  });
}
