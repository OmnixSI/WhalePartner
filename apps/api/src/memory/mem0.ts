import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Memory } from "mem0ai/oss";
import type { ChatProvider } from "../llm/types.ts";
import type { ChatStore } from "../store.ts";
import { startLlmBridge } from "./llm-bridge.ts";
import { EMBEDDING_DIMENSION, LocalEmbedder } from "./local-embedder.ts";
import { createMem0Store, EXTRACTION_HINT } from "./mem0-store.ts";
import type { ConversationTurn, ExperienceInput, MemoryStatus, MemoryStore } from "./types.ts";

export interface MemoryOptions {
  dataDir: string;
  provider: ChatProvider;
  archive?: ChatStore;
}

/** 懒加载本地向量模型和 Mem0；初始化失败后，下次调用会重试。 */
export class LazyMemoryStore implements MemoryStore {
  readonly #options: MemoryOptions;
  #store?: Promise<MemoryStore>;
  #state: MemoryStatus["state"] = "idle";
  #error?: string;

  constructor(options: MemoryOptions) {
    this.#options = options;
  }

  status(): MemoryStatus {
    return { enabled: true, state: this.#state, ...(this.#error ? { error: this.#error } : {}) };
  }

  async warm(): Promise<void> {
    await this.#ready();
  }

  #ready(): Promise<MemoryStore> {
    if (!this.#store) {
      this.#state = "loading";
      this.#store = this.#create().then(
        (store) => {
          this.#state = "ready";
          this.#error = undefined;
          return store;
        },
        (error: unknown) => {
          this.#state = "error";
          this.#error = error instanceof Error ? error.message : String(error);
          this.#store = undefined;
          throw error;
        },
      );
    }
    return this.#store;
  }

  async #create(): Promise<MemoryStore> {
    const { dataDir, provider, archive } = this.#options;
    mkdirSync(dataDir, { recursive: true });
    const embedder = new LocalEmbedder(join(dataDir, "models"));
    await embedder.warm();
    const bridge = await startLlmBridge(provider);
    const memory = new Memory({
      version: "v1.1",
      embedder: { provider: "langchain", config: { model: embedder } },
      vectorStore: { provider: "memory", config: { collectionName: "whalepartner", dimension: EMBEDDING_DIMENSION, dbPath: join(dataDir, "vectors.db") } },
      llm: { provider: "openai", config: { apiKey: bridge.apiKey, baseURL: bridge.baseUrl, model: "whalepartner-bridge" } },
      historyDbPath: join(dataDir, "history.db"),
      customInstructions: EXTRACTION_HINT,
    } as ConstructorParameters<typeof Memory>[0]);
    return createMem0Store(memory, archive);
  }

  async remember(turns: ConversationTurn[]) { return (await this.#ready()).remember(turns); }
  async recall(query: string, limit?: number) { return (await this.#ready()).recall(query, limit); }
  async search(query: string, limit?: number) {
    const store = await this.#ready();
    return store.search ? store.search(query, limit) : store.recall(query, limit);
  }
  async recentExperiences(limit?: number) { return (await this.#ready()).recentExperiences(limit); }
  async recentLearnings(limit?: number, character?: string) { return (await this.#ready()).recentLearnings(limit, character); }
  async addExperience(input: ExperienceInput) {
    const archived = input.kind === "fact" ? undefined : this.#options.archive?.upsertExperience(input);
    const stored = { ...input, sourceId: input.sourceId ?? archived?.sourceId };
    try {
      return await (await this.#ready()).addExperience(stored);
    } catch (error) {
      if (!archived) throw error;
      this.#options.archive?.markExperienceIndexFailed(archived.id, error instanceof Error ? error.message : String(error));
      return {
        id: `local-exp:${archived.id}`,
        text: `${stored.title}\n${stored.text}`.trim(),
        kind: "experience" as const,
        createdAt: archived.createdAt,
        source: stored.kind,
        title: stored.title,
        url: stored.url,
        sourceId: archived.sourceId,
      };
    }
  }
  async list() { return (await this.#ready()).list(); }
  async remove(id: string) { return (await this.#ready()).remove(id); }
  async removeBySourceId(sourceId: string) {
    const store = await this.#ready();
    if (store.removeBySourceId) return store.removeBySourceId(sourceId);
    for (const entry of await store.list()) {
      if (entry.sourceId === sourceId) await store.remove(entry.id);
    }
  }
  async syncPendingExperiences() {
    if (!this.#options.archive || (!this.#options.archive.pendingExperienceIndexes(1).length && !this.#options.archive.pendingFacts(0, 1).length)) return;
    await (await this.#ready()).syncPendingExperiences?.();
  }
}
