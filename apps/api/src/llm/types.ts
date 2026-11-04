export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** 流式回复的一个片段：文字增量，或结束时的用量。provider 由路由层补上。 */
export interface LlmDelta {
  text?: string;
  usage?: LlmUsage;
  provider?: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  stream(messages: ChatMessage[], options?: StreamOptions): AsyncIterable<LlmDelta>;
  /** 可选：探测上游可用模型，用于启动自检。 */
  listModels?(signal?: AbortSignal): Promise<string[]>;
}
