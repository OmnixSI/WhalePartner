import { EmotionFilter, type Emotion } from "./emotion.ts";
import type { ChatMessage, ChatProvider, LlmUsage } from "./llm/types.ts";
import { buildSystemPrompt } from "./persona/persona.ts";
import type { ChatStore } from "./store.ts";

export const MAX_MESSAGE_CHARS = 2000;
const HISTORY_LIMIT = 24;

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "emotion"; emotion: Emotion }
  | { type: "done"; messageId: number; emotion: Emotion; provider?: string; usage?: LlmUsage };

export interface ChatDeps {
  provider: ChatProvider;
  store: ChatStore;
}

export class ChatInputError extends Error {}

export function validateUserMessage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ChatInputError("消息不能为空。");
  const text = value.trim();
  if (text.length > MAX_MESSAGE_CHARS) throw new ChatInputError(`消息太长了（最多 ${MAX_MESSAGE_CHARS} 字）。`);
  return text;
}

/**
 * 一轮聊天：存下用户消息 → 拼人格和最近对话 → 流式回复 → 存下回复。
 * 回复里的情绪标签被剥离并转成 emotion 事件；中途被取消的回复不入库。
 */
export async function* runChat(deps: ChatDeps, userText: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const { provider, store } = deps;
  const userMessage = store.add("user", userText);

  const history: ChatMessage[] = store.recent(HISTORY_LIMIT).map((message) => ({ role: message.role, content: message.content }));
  const messages: ChatMessage[] = [{ role: "system", content: buildSystemPrompt() }, ...history];

  const filter = new EmotionFilter();
  let reply = "";
  let first: Emotion | undefined;
  let usedProvider: string | undefined;
  let usage: LlmUsage | undefined;

  const emit = function* (text: string, emotions: Emotion[]): Generator<ChatEvent> {
    for (const emotion of emotions) {
      first ??= emotion;
      yield { type: "emotion", emotion };
    }
    if (!reply) text = text.trimStart();
    if (text) {
      reply += text;
      yield { type: "delta", text };
    }
  };

  try {
    for await (const delta of provider.stream(messages, { signal })) {
      if (delta.provider) usedProvider = delta.provider;
      if (delta.usage) usage = delta.usage;
      if (delta.text) {
        const { text, emotions } = filter.feed(delta.text);
        yield* emit(text, emotions);
      }
    }
    yield* emit(filter.flush(), []);
  } catch (error) {
    // 一个字都没回出来就失败：撤掉这条用户消息，重试时不会在历史里重复。
    if (!reply) store.remove(userMessage.id);
    throw error;
  }

  signal?.throwIfAborted();
  const emotion = first ?? "neutral";
  if (!reply.trim()) throw new Error("模型没有返回内容。");
  const saved = store.add("assistant", reply.trimEnd(), emotion);
  yield { type: "done", messageId: saved.id, emotion, provider: usedProvider, usage };
}
