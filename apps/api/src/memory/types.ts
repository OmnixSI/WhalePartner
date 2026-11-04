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
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface MemoryStore {
  /** 从一轮对话里提炼并保存关于用户的事实。 */
  remember(turns: ConversationTurn[]): Promise<void>;
  /** 按语义召回与 query 相关的用户事实。 */
  recall(query: string, limit?: number): Promise<MemoryEntry[]>;
  /** 最近的经历（视频摘要、日记），新的在前。 */
  recentExperiences(limit?: number): Promise<MemoryEntry[]>;
  /** 原样保存一段经历，不经过事实提炼。 */
  addExperience(input: ExperienceInput): Promise<MemoryEntry>;
  list(): Promise<MemoryEntry[]>;
  remove(id: string): Promise<void>;
}

export interface MemoryStatus {
  enabled: boolean;
  state: "idle" | "ready" | "error";
  error?: string;
}
