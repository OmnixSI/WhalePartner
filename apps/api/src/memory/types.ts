export type MemoryKind = "fact" | "experience";

export interface MemoryEntry {
  id: string;
  text: string;
  kind: MemoryKind;
  createdAt?: string;
  /** 经历的来源（视频、日记…），仅 kind 为 experience 时有。 */
  source?: string;
  title?: string;
  url?: string;
  sourceId?: string;
}

export interface ExperienceInput {
  /** 经历类型，例如 "video"、"diary"。 */
  kind: string;
  title: string;
  text: string;
  url?: string;
  /** 来源的稳定标识（例如 BV 号）。同一个 sourceId 再写入会替换旧的。 */
  sourceId?: string;
  sourceSessionId?: string;
  sourceSessionIds?: string[];
  sourceMessageId?: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface MemoryStore {
  /** 从一轮对话里提炼并保存关于用户的事实。 */
  remember(turns: ConversationTurn[]): Promise<string[] | void>;
  /** 按语义召回与 query 相关的用户事实。 */
  recall(query: string, limit?: number): Promise<MemoryEntry[]>;
  /** 搜索所有 Mem0 记录，包含长期事实、会话片段和外部内容经历。 */
  search?(query: string, limit?: number): Promise<MemoryEntry[]>;
  /** 最近的经历（视频摘要、日记），新的在前；不含“学到的”。 */
  recentExperiences(limit?: number): Promise<MemoryEntry[]>;
  /** 最近学到的梗和知识，新的在前。 */
  recentLearnings(limit?: number, character?: string): Promise<MemoryEntry[]>;
  /** 原样保存一段经历，不经过事实提炼。 */
  addExperience(input: ExperienceInput): Promise<MemoryEntry>;
  list(): Promise<MemoryEntry[]>;
  remove(id: string): Promise<void>;
  /** 删除指定来源标识对应的向量条目，用于更新已失效的本地事实。 */
  removeBySourceId?(sourceId: string): Promise<void>;
  /** 从 SQLite outbox 恢复尚未写入本机向量索引的经历。 */
  syncPendingExperiences?(): Promise<void>;
}

export interface MemoryStatus {
  enabled: boolean;
  state: "idle" | "loading" | "ready" | "error";
  error?: string;
}
