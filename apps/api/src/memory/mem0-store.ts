import { Memory, type MemoryItem } from "mem0ai/oss";
import type { ChatStore } from "../store.ts";
import type { ConversationTurn, ExperienceInput, MemoryEntry, MemoryStore } from "./types.ts";

const USER_ID = "local-user";
const MAX_LIST = 500;
// bge-small-zh 的余弦相似度整体偏高：相关约 0.38–0.48，明显无关约 0.22–0.25，闲聊在 0.3–0.36 之间。
// 0.3 只挡掉明显无关的；闲聊偶尔带上一两条事实无妨，人格提示要求自然使用、不逐条背诵。
const RECALL_THRESHOLD = 0.3;

export const EXTRACTION_HINT =
  "只提取用户明确说出的、之后聊天还用得上的事实（名字、家人宠物、喜好、近况、计划、重要日子）。用中文，一条一句，以“用户”作主语，" +
  "不要记录助手说的话，不要记录密码、验证码、银行卡号等敏感信息。";

function toEntry(item: MemoryItem): MemoryEntry {
  const meta = item.metadata ?? {};
  const experience = meta.kind === "experience";
  return {
    id: item.id,
    text: item.memory,
    kind: experience ? "experience" : "fact",
    createdAt: item.createdAt,
    ...(experience
      ? {
          source: typeof meta.source === "string" ? meta.source : undefined,
          title: typeof meta.title === "string" ? meta.title : undefined,
          url: typeof meta.url === "string" ? meta.url : undefined,
          sourceId: typeof meta.sourceId === "string" ? meta.sourceId : undefined,
        }
      : {}),
  };
}

const byNewest = (a: MemoryEntry, b: MemoryEntry) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "");

/** mem0（Apache-2.0）OSS 的封装：事实走 LLM 提炼，经历原样保存。 */
class Mem0Store implements MemoryStore {
  readonly #memory: Memory;
  readonly #archive?: ChatStore;

  constructor(memory: Memory, archive?: ChatStore) {
    this.#memory = memory;
    this.#archive = archive;
  }

  async remember(turns: ConversationTurn[]) {
    const added = await this.#memory.add(turns, { userId: USER_ID });
    return added.results.map((item) => item.id);
  }

  async recall(query: string, limit = 5) {
    const found = await this.#memory.search(query, { filters: { user_id: USER_ID }, topK: limit * 3, threshold: RECALL_THRESHOLD });
    return found.results.map(toEntry).filter((entry) => entry.kind === "fact").slice(0, limit);
  }

  async search(query: string, limit = 8) {
    const found = await this.#memory.search(query, { filters: { user_id: USER_ID }, topK: limit * 3, threshold: RECALL_THRESHOLD });
    const entries = found.results.map(toEntry);
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    }).slice(0, limit);
  }

  async list() {
    return (await this.#listAll()).filter((entry) => entry.source !== "fact" && entry.source !== "chat");
  }

  async #listAll() {
    const all = await this.#memory.getAll({ filters: { user_id: USER_ID }, topK: MAX_LIST });
    return all.results.map(toEntry).sort(byNewest);
  }

  async recentExperiences(limit = 3) {
    return (await this.list()).filter((entry) => entry.kind === "experience" && entry.source !== "learned").slice(0, limit);
  }

  async recentLearnings(limit = 4, _character?: string) {
    return (await this.list())
      .filter((entry) => entry.kind === "experience" && entry.source === "learned")
      .slice(0, limit);
  }

  async addExperience(input: ExperienceInput) {
    const archived = input.sourceId ? this.#archive?.experienceBySourceId(input.sourceId) : undefined;
    try {
      const entry = await this.#indexExperience(input);
      if (archived) this.#archive?.markExperienceIndexed(archived.id, entry.id);
      return entry;
    } catch (error) {
      if (archived) {
        this.#archive?.markExperienceIndexFailed(archived.id, error instanceof Error ? error.message : String(error));
        return {
          id: `local-exp:${archived.id}`,
          text: `${input.title}\n${input.text}`.trim(),
          kind: "experience" as const,
          createdAt: archived.createdAt,
          source: input.kind,
          title: input.title,
          url: input.url,
          sourceId: archived.sourceId,
        };
      }
      throw error;
    }
  }

  async #indexExperience(input: ExperienceInput) {
    if (input.sourceId) {
      const factId = input.sourceId.startsWith("fact:") ? Number(input.sourceId.slice("fact:".length)) : undefined;
      const archived = this.#archive?.experienceBySourceId(input.sourceId);
      const mappedId = factId && Number.isInteger(factId)
        ? this.#archive?.factVectorId(factId)
        : archived?.vectorEntryId;
      if (mappedId) {
        await this.#memory.delete(mappedId);
        if (factId && Number.isInteger(factId)) this.#archive?.setFactVectorId(factId, null);
        if (archived) this.#archive?.setExperienceVectorId(archived.id, null);
      } else if (!archived && !this.#archive) {
        const previous = (await this.#listAll()).filter((entry) => entry.kind === "experience" && entry.sourceId === input.sourceId);
        for (const entry of previous) await this.#memory.delete(entry.id);
      }
    }
    const text = `${input.title}\n${input.text}`.trim();
    const added = await this.#memory.add(text, {
      userId: USER_ID,
      infer: false,
      metadata: { kind: "experience", source: input.kind, title: input.title, url: input.url, sourceId: input.sourceId },
    });
    const item = added.results[0];
    if (!item) throw new Error("经历没有写入记忆。");
    const factId = input.sourceId?.startsWith("fact:") ? Number(input.sourceId.slice("fact:".length)) : undefined;
    const archived = input.sourceId ? this.#archive?.experienceBySourceId(input.sourceId) : undefined;
    if (factId && Number.isInteger(factId)) this.#archive?.setFactVectorId(factId, item.id);
    if (archived) this.#archive?.setExperienceVectorId(archived.id, item.id);
    const entry: MemoryEntry = { id: item.id, text, kind: "experience", createdAt: item.createdAt, source: input.kind, title: input.title, url: input.url, sourceId: input.sourceId };
    return entry;
  }

  async remove(id: string) {
    await this.#memory.delete(id);
  }

  async removeBySourceId(sourceId: string) {
    const factId = sourceId.startsWith("fact:") ? Number(sourceId.slice("fact:".length)) : undefined;
    const archived = this.#archive?.experienceBySourceId(sourceId);
    const mappedId = factId && Number.isInteger(factId)
      ? this.#archive?.factVectorId(factId)
      : archived?.vectorEntryId;
    if (mappedId) {
      await this.#memory.delete(mappedId);
    } else {
      const entries = (await this.#listAll()).filter((entry) => entry.sourceId === sourceId);
      for (const entry of entries) await this.#memory.delete(entry.id);
    }
    this.#archive?.removeExperienceBySourceId(sourceId);
    if (factId && Number.isInteger(factId)) this.#archive?.setFactVectorId(factId, null);
  }

  async syncPendingExperiences() {
    if (!this.#archive) return;
    for (;;) {
      const batch = this.#archive.pendingExperienceIndexes(50);
      if (batch.length === 0) break;
      for (const experience of batch) {
        try {
          await this.#indexExperience({ ...experience });
          this.#archive.markExperienceIndexed(experience.id, this.#archive.experienceBySourceId(experience.sourceId)?.vectorEntryId);
        } catch (error) {
          this.#archive.markExperienceIndexFailed(experience.id, error instanceof Error ? error.message : String(error));
        }
      }
    }
    let afterId = 0;
    for (;;) {
      const batch = this.#archive.pendingFacts(afterId, 50);
      if (batch.length === 0) break;
      for (const fact of batch) {
        afterId = fact.id;
        try {
          await this.#indexExperience({ kind: "fact", title: `${fact.subject} · ${fact.predicate}`.slice(0, 120), text: `${fact.subject}的${fact.predicate}：${fact.value}`, sourceId: `fact:${fact.id}` });
        } catch (error) {
          console.warn("事实语义索引重建失败：", error instanceof Error ? error.message : error);
        }
      }
    }
  }
}

export function createMem0Store(memory: Memory, archive?: ChatStore): MemoryStore {
  return new Mem0Store(memory, archive);
}
