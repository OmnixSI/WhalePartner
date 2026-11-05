import { EmotionFilter, type Emotion } from "./emotion.ts";
import type { ChatMessage, ChatProvider, LlmUsage } from "./llm/types.ts";
import type { MemoryStore } from "./memory/types.ts";
import { buildChatContext } from "./memory/context.ts";
import { scheduleMemoryJobs } from "./memory/jobs.ts";
import { recallChatMemory } from "./memory/recall.ts";
import { queueLearning, queueReflection } from "./chat-background.ts";
import { readWeb, watchVideo } from "./chat-materials.ts";
import { extractVideoTarget, type VideoService } from "./video-service.ts";
import { extractWebTarget, type WebService } from "./web-service.ts";
import { buildPersonaCore, CHARACTERS, DEFAULT_CHARACTER, type CharacterId } from "./persona/persona.ts";
import type { ChatStore } from "./store.ts";

export const MAX_MESSAGE_CHARS = 2000;
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "video"; stage: "reading" | "watching" | "thinking" | "failed"; message: string; title?: string }
  | { type: "web"; stage: "reading" | "summarizing" | "failed"; message: string; title?: string }
  | { type: "emotion"; emotion: Emotion }
  | { type: "done"; messageId: number; sessionId: string; emotion: Emotion; provider?: string; usage?: LlmUsage };

export interface ChatDeps {
  provider: ChatProvider;
  store: ChatStore;
  /** 没有记忆（或记忆出故障）时聊天照常进行，只是不带记忆。 */
  memory?: MemoryStore;
  /** 当前聊天的角色，决定人格和聊天记录；默认鲸汐。 */
  character?: CharacterId;
  /** 当前本机会话。省略时继续该角色最近一次会话。 */
  sessionId?: string;
  /** 模型输入上下文预算的保守估算值。 */
  inputBudget?: number;
  /** 提供后，用户消息里的 B 站链接会被“看完”再聊。 */
  video?: VideoService;
  /** 提供后，用户消息里的普通网页链接会被读完再聊。 */
  web?: WebService;
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
  const { provider, store, memory } = deps;
  const character = deps.character ?? DEFAULT_CHARACTER;
  const session = store.getOrCreateSession(character, deps.sessionId);
  const userMessage = store.add("user", userText, null, character, session.id);
  const recalled = await recallChatMemory({ store, memory, character, sessionId: session.id, query: userText });
  let situation: string | undefined;
  const videoTarget = deps.video ? extractVideoTarget(userText) : undefined;
  const webTarget = deps.web && !videoTarget ? extractWebTarget(userText) : undefined;
  if (deps.video && videoTarget) {
    situation = yield* watchVideo(deps, character, deps.video, videoTarget, session.id, userMessage.id);
  } else if (deps.web && webTarget) {
    situation = yield* readWeb(deps, character, deps.web, webTarget, session.id, userMessage.id);
  }

  const messages = buildChatContext({
    persona: buildPersonaCore(character),
    observation: recalled.observation,
    memories: recalled.facts.slice(0, 8),
    experiences: recalled.experiences.slice(0, 5),
    learned: recalled.learned,
    note: store.getNote(character)?.text,
    situation,
    archive: recalled.archive,
    history: recalled.history,
    inputBudget: deps.inputBudget ?? 24_000,
  });

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
  const saved = store.add("assistant", reply.trimEnd(), emotion, character, session.id);
  store.enqueueMemoryJob({ sessionId: session.id, character, userMessageId: userMessage.id, assistantMessageId: saved.id });
  void scheduleMemoryJobs({ store, provider, memory });
  queueReflection(deps, character, false);
  yield { type: "done", messageId: saved.id, sessionId: session.id, emotion, provider: usedProvider, usage };
}
