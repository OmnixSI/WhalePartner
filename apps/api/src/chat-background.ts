import type { ChatDeps } from "./chat.ts";
import { CHARACTERS, type CharacterId } from "./persona/persona.ts";
import { learnFrom } from "./learning.ts";
import { reflect } from "./reflect.ts";

let backgroundQueue: Promise<unknown> = Promise.resolve();

function queueBackground(label: string, task: () => Promise<void>) {
  const debug = process.env.WP_DEBUG ? (message: string) => console.log(`[后台] ${label} ${message}`) : () => {};
  backgroundQueue = backgroundQueue.then(async () => {
    debug("开始");
    await task();
    debug("完成");
  }).catch((error: unknown) => {
    console.warn(`${label}失败：`, error instanceof Error ? error.message : error);
  });
}

const REFLECT_EVERY = 12;

export function queueReflection(deps: ChatDeps, character: CharacterId, force: boolean) {
  const { provider, store, memory } = deps;
  const count = store.countAssistant(character);
  const previous = store.getNote(character);
  if (!force && count - (previous?.assistantCount ?? 0) < REFLECT_EVERY) return;
  queueBackground("写近况小记", async () => {
    if (!force) {
      const mine = store.recent(14, character).filter((message) => message.role === "user").map((message) => message.content.slice(0, 160));
      if (mine.length >= 4) await learnFrom({ provider, memory, store }, { title: "用户最近的说法", text: mine.join("\n") }, `chat:${character}:${count}`);
    }
    const learned = memory
      ? (await memory.recentLearnings(4, character).catch(() => [])).map((entry) => entry.text)
      : store.recentExperiences(100, false, character).filter((entry) => entry.kind === "learned").slice(0, 4).map((entry) => entry.text);
    const chat = store.recent(14, character).map((message) => `${message.role === "user" ? "用户" : "她"}：${message.content.slice(0, 160)}`);
    const note = await reflect(provider, { name: CHARACTERS[character].name, previous: previous?.text, learned, chat });
    if (note) store.setNote(character, note, count);
  });
}

export function queueLearning(deps: ChatDeps, character: CharacterId, material: { title: string; text: string }, key: string) {
  queueBackground("整理学到的东西", async () => {
    const learned = await learnFrom({ provider: deps.provider, memory: deps.memory, store: deps.store }, material, key);
    if (learned.length > 0) queueReflection(deps, character, true);
  });
}
