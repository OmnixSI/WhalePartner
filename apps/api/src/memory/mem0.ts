import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Memory, type MemoryItem } from "mem0ai/oss";
import type { ChatProvider } from "../llm/types.ts";
import { startLlmBridge } from "./llm-bridge.ts";
import { EMBEDDING_DIMENSION, LocalEmbedder } from "./local-embedder.ts";
import type { ConversationTurn, ExperienceInput, MemoryEntry, MemoryStatus, MemoryStore } from "./types.ts";

const USER_ID = "local-user";
const MAX_LIST = 500;
// bge-small-zh 的余弦相似度整体偏高：相关约 0.38–0.48，明显无关约 0.22–0.25，闲聊在 0.3–0.36 之间。
// 0.3 只挡掉明显无关的；闲聊偶尔带上一两条事实无妨，人格提示要求自然使用、不逐条背诵。
const RECALL_THRESHOLD = 0.3;

const EXTRACTION_HINT =
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

  constructor(memory: Memory) {
    this.#memory = memory;
  }

  async remember(turns: ConversationTurn[]) {
    await this.#memory.add(turns, { userId: USER_ID });
  }

  async recall(query: string, limit = 5) {
    const found = await this.#memory.search(query, { filters: { user_id: USER_ID }, topK: limit * 3, threshold: RECALL_THRESHOLD });
    return found.results.map(toEntry).filter((entry) => entry.kind === "fact").slice(0, limit);
  }

  async list() {
    const all = await this.#memory.getAll({ filters: { user_id: USER_ID }, topK: MAX_LIST });
    return all.results.map(toEntry).sort(byNewest);
  }

  async recentExperiences(limit = 3) {
    return (await this.list()).filter((entry) => entry.kind === "experience").slice(0, limit);
  }

  async addExperience(input: ExperienceInput) {
    if (input.sourceId) {
      const previous = (await this.list()).filter((entry) => entry.kind === "experience" && entry.sourceId === input.sourceId);
      for (const entry of previous) await this.#memory.delete(entry.id);
    }
    const text = `${input.title}\n${input.text}`.trim();
    const added = await this.#memory.add(text, {
      userId: USER_ID,
      infer: false,
      metadata: { kind: "experience", source: input.kind, title: input.title, url: input.url, sourceId: input.sourceId },
    });
    const item = added.results[0];
    if (!item) throw new Error("经历没有写入记忆。");
    // add 返回的条目不带 metadata，按写入内容补全。
    const entry: MemoryEntry = { id: item.id, text, kind: "experience", createdAt: item.createdAt, source: input.kind, title: input.title, url: input.url, sourceId: input.sourceId };
    return entry;
  }

  async remove(id: string) {
    await this.#memory.delete(id);
  }
}

export interface MemoryOptions {
  dataDir: string;
  provider: ChatProvider;
}

/**
 * 懒加载：第一次真正用到记忆时才加载向量模型、起 mem0。
 * 初始化失败不会拖垮聊天，状态里能看到原因，下次调用会重试。
 */
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

  #ready(): Promise<MemoryStore> {
    this.#store ??= this.#create().then(
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
    return this.#store;
  }

  async #create(): Promise<MemoryStore> {
    const { dataDir, provider } = this.#options;
    mkdirSync(dataDir, { recursive: true });
    const bridge = await startLlmBridge(provider);
    const memory = new Memory({
      version: "v1.1",
      embedder: { provider: "langchain", config: { model: new LocalEmbedder(join(dataDir, "models")) } },
      vectorStore: { provider: "memory", config: { collectionName: "whalepartner", dimension: EMBEDDING_DIMENSION, dbPath: join(dataDir, "vectors.db") } },
      llm: { provider: "openai", config: { apiKey: bridge.apiKey, baseURL: bridge.baseUrl, model: "whalepartner-bridge" } },
      historyDbPath: join(dataDir, "history.db"),
      customInstructions: EXTRACTION_HINT,
    } as ConstructorParameters<typeof Memory>[0]);
    return new Mem0Store(memory);
  }

  async remember(turns: ConversationTurn[]) { return (await this.#ready()).remember(turns); }
  async recall(query: string, limit?: number) { return (await this.#ready()).recall(query, limit); }
  async recentExperiences(limit?: number) { return (await this.#ready()).recentExperiences(limit); }
  async addExperience(input: ExperienceInput) { return (await this.#ready()).addExperience(input); }
  async list() { return (await this.#ready()).list(); }
  async remove(id: string) { return (await this.#ready()).remove(id); }
}
