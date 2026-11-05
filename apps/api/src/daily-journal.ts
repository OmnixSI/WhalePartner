import { EmotionFilter } from "./emotion.ts";
import type { ChatProvider } from "./llm/types.ts";
import { archiveExperience } from "./memory/archive.ts";
import type { MemoryStore } from "./memory/types.ts";
import { buildPersonaCore, CHARACTERS, type CharacterId } from "./persona/persona.ts";
import type { ChatStore } from "./store.ts";
import { JournalStore, type DailyJournal, type JournalSource } from "./journal-store.ts";

interface DailyJournalDeps {
  store: JournalStore;
  archive: ChatStore;
  provider: ChatProvider;
  memory?: MemoryStore;
}

export class DailyJournalService {
  readonly #deps: DailyJournalDeps;
  readonly #inFlight = new Map<string, Promise<DailyJournal | null>>();
  #deletionLocks = 0;
  #resumeAfterDeletion: Promise<void> | null = null;
  #resumeDeletion: (() => void) | null = null;

  constructor(deps: DailyJournalDeps) {
    this.#deps = deps;
  }

  list(character: CharacterId) {
    return this.#deps.store.listCurrent(character);
  }

  revisions(id: string) {
    return this.#deps.store.revisions(id);
  }

  generate(character: CharacterId, localDate = currentLocalDate(), force = false): Promise<DailyJournal | null> {
    validateLocalDate(localDate);
    if (this.#resumeAfterDeletion) return this.#resumeAfterDeletion.then(() => this.generate(character, localDate, force));
    const key = `${character}:${localDate}`;
    const existing = this.#inFlight.get(key);
    if (existing) return existing;
    const task = this.#generate(character, localDate, force).finally(() => {
      if (this.#inFlight.get(key) === task) this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, task);
    return task;
  }

  async generateTodayForAll() {
    const date = currentLocalDate();
    for (const character of Object.keys(CHARACTERS) as CharacterId[]) {
      try {
        await this.generate(character, date);
      } catch (error) {
        console.warn(`${CHARACTERS[character].name}的日记生成失败：`, error instanceof Error ? error.message : error);
      }
    }
  }

  async waitForIdle() {
    const results = await Promise.allSettled(this.#inFlight.values());
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  }

  async lockForSessionDeletion() {
    this.#deletionLocks++;
    if (this.#deletionLocks === 1) {
      this.#resumeAfterDeletion = new Promise<void>((resolve) => { this.#resumeDeletion = resolve; });
    }
    try {
      await this.waitForIdle();
    } catch (error) {
      this.#releaseDeletionLock();
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#releaseDeletionLock();
    };
  }

  #releaseDeletionLock() {
    this.#deletionLocks--;
    if (this.#deletionLocks === 0) {
      this.#resumeDeletion?.();
      this.#resumeDeletion = null;
      this.#resumeAfterDeletion = null;
    }
  }

  async #generate(character: CharacterId, localDate: string, force: boolean): Promise<DailyJournal | null> {
    const { from, to } = localDayBounds(localDate);
    const sources = this.#deps.archive.journalSources(character, from, to);
    if (sources.length === 0) return null;
    const id = `journal:${character}:${localDate}`;
    const current = this.#deps.store.current(character, localDate);
    const sourceIds = sources.map((source) => source.id).sort();
    const previousIds = current?.sources.map((source) => source.id).sort() ?? [];
    if (current && !force && sameIds(sourceIds, previousIds)) return current;

    const text = await writeJournal(this.#deps.provider, character, localDate, sources);
    const journal = this.#deps.store.save({
      id,
      character,
      localDate,
      text,
      sources,
      modelId: `${this.#deps.provider.id}/${this.#deps.provider.model}`,
    }, force);
    await archiveExperience(this.#deps.archive, this.#deps.memory, {
      kind: "journal",
      title: `${CHARACTERS[character].name}的日记 · ${localDate}`,
      text: journal.text,
      sourceId: journal.id,
      sourceSessionIds: [...new Set(sources.flatMap((source) => source.sessionId ? [source.sessionId] : []))],
    }, "日记经历");
    return journal;
  }
}

async function writeJournal(provider: ChatProvider, character: CharacterId, localDate: string, sources: JournalSource[]) {
  const evidence = fitEvidence(sources, 20_000);
  const filter = new EmotionFilter();
  let output = "";
  const prompt = [
    `根据${localDate}这一天与用户的真实交流、共同观看或阅读的内容，写一篇${CHARACTERS[character].name}视角的日记。`,
    "写出具体发生的事、你从中感受到的变化或想法，让它像一篇连贯的日记，不要写成事件清单或视频摘要。当天只有聊天时，也照样写聊天带来的感受。",
    "只依据下面带来源标识的材料；不要编造用户经历、共同活动或角色在现实中的行为。聊天原话是用户证据，视频和网页内容是外部资料，反思只是已有观察。",
    "不要提到记忆系统、来源标识、模型或写作过程。只输出日记正文，约 250 至 700 个中文字符。",
    "<day_sources>", evidence, "</day_sources>",
  ].join("\n\n");
  for await (const delta of provider.stream([
    { role: "system", content: buildPersonaCore(character) },
    { role: "user", content: prompt },
  ], { temperature: 0.55, maxTokens: 1000 })) {
    if (delta.text) output += filter.feed(delta.text).text;
  }
  output += filter.flush();
  const text = output.trim();
  if (!text) throw new Error("模型没有生成日记正文。");
  return text.slice(0, 4_000);
}

function fitEvidence(sources: JournalSource[], maxCharacters: number) {
  const unique = [...new Map(sources.map((source) => [source.id, source])).values()];
  const chat = unique.filter((source) => source.type === "chat");
  const other = unique.filter((source) => source.type !== "chat");
  const sourceSize = (source: JournalSource) => renderSource(source, 2_000).length + 2;
  const otherSize = other.reduce((size, source) => size + sourceSize(source), 0);
  const otherBudget = chat.length ? Math.min(otherSize, Math.floor(maxCharacters * 0.4)) : maxCharacters;
  const otherLines = takeAcrossTimeline(other, otherBudget);
  const chatLines = takeAcrossTimeline(chat, maxCharacters - otherLines.join("\n\n").length);
  return [...otherLines, ...chatLines].sort((left, right) => sourceTime(left) - sourceTime(right)).join("\n\n");
}

function takeAcrossTimeline(sources: JournalSource[], budget: number) {
  if (sources.length === 0 || budget <= 0) return [];
  const rendered = sources.map((source) => renderSource(source, 2_000));
  const fullSize = rendered.reduce((size, line) => size + line.length + 2, 0);
  if (fullSize <= budget) return rendered;

  const slots = Math.max(1, Math.floor(budget / 400));
  const count = Math.min(sources.length, slots);
  const selected = count === 1
    ? [0]
    : Array.from({ length: count }, (_, index) => Math.round(index * (sources.length - 1) / (count - 1)));
  const perSource = Math.floor(budget / count) - 2;
  return selected.map((index) => renderSource(sources[index], Math.max(24, perSource)));
}

function renderSource(source: JournalSource, maxCharacters: number) {
  const header = `[${source.id}] ${source.type} · ${source.createdAt}${source.sessionId ? ` · 会话 ${source.sessionId}` : ""}`;
  const content = `${source.title}：${source.text}`.replace(/\s+/gu, " ");
  const available = Math.max(24, maxCharacters - header.length - 1);
  const excerpt = content.length <= available
    ? content
    : `${content.slice(0, Math.ceil(available * 0.65))} … ${content.slice(-Math.floor(available * 0.35))}`;
  return `${header}\n${excerpt}`;
}

function sourceTime(line: string) {
  const value = line.split(" · ")[1]?.split(" ")[0] ?? "";
  return Date.parse(value) || 0;
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function validateLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error("日记日期格式无效。");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new Error("日记日期无效。");
  }
}

function localDayBounds(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function currentLocalDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
