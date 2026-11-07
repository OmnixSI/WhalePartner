import type { MemoryEntry, MemoryStore } from "./types.ts";
import { clarityOf, decayForPrompt } from "./decay.ts";
import { matchesTimeWindow, overlapsFactTimeWindow, type ChatStore } from "../store.ts";
import type { ArchiveHit, StoredExperience, StoredFact } from "../store/types.ts";
import type { CharacterId } from "../persona/persona.ts";

/** 首字要快：记忆向量检索最多等 1.5 秒，超时这一轮就不带向量召回（本地事实/经历照常）。 */
export const RECALL_TIMEOUT_MS = 1_500;

export interface MemoryRecall {
  facts: string[];
  experiences: string[];
  learned: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  observation?: string;
  archive: string[];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("记忆召回超时")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function asksAboutHistory(query: string): boolean {
  return /以前|之前|过去|曾经|那时|当时|去年|前年|旧的|原来|历史|上个月|上周|(?:19|20)\d{2}年?/u.test(query);
}

function asksAboutRecentExperiences(query: string): boolean {
  return /最近|刚才|刚刚|今天|昨天|这周|本周|这几天|看过什么|一起经历|共同经历|上一次|最近一次/u.test(query);
}

function localFactLine(fact: StoredFact): string {
  const source = fact.sources[0];
  const period = fact.status === "active"
    ? `当前，自 ${fact.validFrom.slice(0, 10)}`
    : `历史，${fact.validFrom.slice(0, 10)} 至 ${fact.validTo?.slice(0, 10) ?? "后来"}`;
  const evidence = source ? `；来源：消息 ${source.messageId}「${source.quote}」` : "";
  return `${period}，${fact.subject}的${fact.predicate}：${fact.value}${evidence}`;
}

function memoryLine(entry: MemoryEntry, store: ChatStore, query: string): { kind: "fact" | "experience"; text: string } | undefined {
  if (entry.sourceId?.startsWith("fact:")) {
    const factId = Number(entry.sourceId.slice("fact:".length));
    const fact = Number.isInteger(factId) ? store.getFact(factId) : undefined;
    if (!fact || (fact.status !== "active" && !asksAboutHistory(query)) || !overlapsFactTimeWindow(fact.validFrom, fact.validTo, query)) return undefined;
    return { kind: "fact", text: localFactLine(fact) };
  }
  const archived = entry.sourceId ? store.experienceBySourceId(entry.sourceId) : undefined;
  if (archived) {
    if (!matchesTimeWindow(archived.createdAt, query)) return undefined;
    return {
      kind: "experience",
      text: `${archived.kind}经历（${archived.createdAt.slice(0, 10)}；本机来源 ${archived.sourceId}）《${archived.title}》：${archived.text.slice(0, 700)}`,
    };
  }
  if (entry.source === "chat" || entry.sourceId?.startsWith("chat:")) return undefined;
  if (!matchesTimeWindow(entry.createdAt, query)) return undefined;
  const created = entry.createdAt?.slice(0, 10) ?? "日期不详";
  if (entry.kind === "fact") {
    return { kind: "fact", text: `历史记忆（${created}，尚无原始消息来源）：${entry.text.slice(0, 500)}` };
  }
  const source = entry.source ?? "经历";
  const title = entry.title ? `《${entry.title}》` : "";
  const sourceId = entry.sourceId ? `；来源标识 ${entry.sourceId}` : "";
  return { kind: "experience", text: `${source}经历（${created}）${title}${sourceId}：${entry.text.slice(0, 700)}` };
}

function archivedLearnedLine(archived: StoredExperience) {
  return {
    text: archived.text.slice(0, 700),
    createdAt: archived.createdAt,
    provenance: `外部内容提炼（${archived.createdAt.slice(0, 10)}；本机来源 ${archived.sourceId}）《${archived.title}》`,
  };
}

function learnedLine(entry: MemoryEntry, store: ChatStore, query: string): { text: string; createdAt?: string; provenance: string } | undefined {
  const archived = entry.sourceId ? store.experienceBySourceId(entry.sourceId) : undefined;
  if (archived) {
    if (archived.kind !== "learned" || !matchesTimeWindow(archived.createdAt, query)) return undefined;
    return archivedLearnedLine(archived);
  }
  if (!matchesTimeWindow(entry.createdAt, query)) return undefined;
  const date = entry.createdAt?.slice(0, 10) ?? "日期不详";
  return {
    text: entry.text.slice(0, 700),
    createdAt: entry.createdAt,
    provenance: `外部内容提炼（${date}${entry.sourceId ? `；来源标识 ${entry.sourceId}` : ""}）`,
  };
}

function experienceLine(entry: ReturnType<ChatStore["searchExperiences"]>[number]): string {
  return `${entry.kind}经历（${entry.createdAt.slice(0, 10)}；本机来源 ${entry.sourceId}）《${entry.title}》：${entry.text.slice(0, 700)}`;
}

function archiveLine(hit: ArchiveHit): string {
  const speaker = hit.message.role === "user" ? "用户" : "角色";
  return `${hit.message.createdAt.slice(0, 10)} · ${hit.sessionTitle} · ${speaker}消息 ${hit.message.id}：${hit.message.content.slice(0, 700)}`;
}

export async function recallChatMemory(input: {
  store: ChatStore;
  memory?: MemoryStore;
  character: CharacterId;
  sessionId: string;
  query: string;
  timeoutMs?: number;
}): Promise<MemoryRecall> {
  const { store, memory, character, sessionId, query } = input;
  const facts: string[] = [];
  const experiences: string[] = [];
  let learned: string[] = [];
  const learnedCandidates: Array<{ text: string; createdAt?: string; provenance: string }> = [];
  const recallStarted = performance.now();

  const localFacts = store.searchFacts(query, 6);
  for (const fact of localFacts) {
    if (fact.status === "active" || asksAboutHistory(query)) facts.push(localFactLine(fact));
  }
  const seenSources = new Set<string>();
  for (const experience of store.searchExperiences(query, 6)) {
    if (experience.kind === "learned") {
      const candidate = archivedLearnedLine(experience);
      if (!learnedCandidates.some((item) => item.provenance === candidate.provenance)) learnedCandidates.push(candidate);
    } else {
      experiences.push(experienceLine(experience));
    }
    seenSources.add(experience.sourceId);
  }
  const localRecent = asksAboutRecentExperiences(query)
    ? store.recentExperiences(8, false).filter((experience) => experience.kind !== "learned").slice(0, 2)
    : [];
  if (asksAboutRecentExperiences(query)) {
    for (const experience of localRecent) {
      if (experience.kind !== "chat" && matchesTimeWindow(experience.createdAt, query) && !seenSources.has(experience.sourceId)) {
        if (experience.kind === "learned") {
          const candidate = archivedLearnedLine(experience);
          if (!learnedCandidates.some((item) => item.provenance === candidate.provenance)) learnedCandidates.push(candidate);
        } else {
          experiences.push(`${experience.kind}经历（${experience.createdAt.slice(0, 10)}；本机来源 ${experience.sourceId}）《${experience.title}》：${experience.text.slice(0, 500)}`);
        }
        seenSources.add(experience.sourceId);
      }
    }
  }
  if (memory) {
    try {
      const search = memory.search ? memory.search(query, 12) : memory.recall(query, 5);
      const recent = asksAboutRecentExperiences(query) && localRecent.length === 0
        ? memory.recentExperiences(2)
        : Promise.resolve([]);
      const [recalled, recentEntries] = await withTimeout(Promise.all([search, recent]), input.timeoutMs ?? RECALL_TIMEOUT_MS);
      for (const entry of recalled) {
        const key = entry.sourceId ?? entry.id;
        if (seenSources.has(key)) continue;
        if (entry.source === "learned" || entry.sourceId?.startsWith("learned:")) {
          const formatted = learnedLine(entry, store, query);
          if (formatted && !learnedCandidates.some((candidate) => candidate.provenance === formatted.provenance)) learnedCandidates.push(formatted);
          seenSources.add(key);
          continue;
        }
        const formatted = memoryLine(entry, store, query);
        if (!formatted) continue;
        if (formatted.kind === "fact" && localFacts.some((fact) => fact.value.length > 2 && entry.text.includes(fact.value))) continue;
        const target = formatted.kind === "fact" ? facts : experiences;
        if (!target.includes(formatted.text)) target.push(formatted.text);
        seenSources.add(key);
      }
      for (const entry of recentEntries) {
        const key = entry.sourceId ?? entry.id;
        if (seenSources.has(key)) continue;
        if (entry.source === "learned" || entry.sourceId?.startsWith("learned:")) {
          const candidate = learnedLine(entry, store, query);
          if (candidate && !learnedCandidates.some((item) => item.provenance === candidate.provenance)) learnedCandidates.push(candidate);
          seenSources.add(key);
          continue;
        }
        const formatted = memoryLine(entry, store, query);
        if (formatted?.kind === "experience" && !experiences.includes(formatted.text)) experiences.push(formatted.text);
        seenSources.add(key);
      }
    } catch (error) {
      console.warn("召回记忆失败，这一轮不带记忆：", error instanceof Error ? error.message : error);
    }
  }

  const messages = store.recent(200, character, sessionId);
  const recentIds = new Set(messages.map((message) => message.id));
  const archive = store.searchArchive(query, 12)
    .filter((hit) => !recentIds.has(hit.message.id))
    .map(archiveLine);
  const observationRow = store.observation(sessionId);
  const observation = observationRow
    ? `${store.getSession(sessionId)?.title ?? "当前会话"}（原文消息 ${observationRow.fromMessageId} 至 ${observationRow.throughMessageId}，更新于 ${observationRow.updatedAt.slice(0, 10)}）\n${observationRow.summary}`
    : undefined;
  const retainedLearnings = learnedCandidates.filter((entry) => clarityOf(entry) !== "trace");
  learned = decayForPrompt(retainedLearnings).map((text, index) => `${retainedLearnings[index].provenance}：${text}`);
  if (process.env.WP_DEBUG) {
    console.log(`[记忆] 混合召回 ${Math.round(performance.now() - recallStarted)}ms；事实 ${facts.length} 条，经历 ${experiences.length} 条，原文 ${archive.length} 条。`);
  }
  return {
    facts,
    experiences,
    learned,
    history: messages.map((message) => ({ role: message.role, content: message.content })),
    ...(observation ? { observation } : {}),
    archive,
  };
}
