import { EmotionFilter, type Emotion } from "./emotion.ts";
import { hubEvents, type EventBus } from "../hub/events.ts";
import type { ChatMessage, ChatProvider, LlmUsage } from "../llm/types.ts";
import type { MemoryStore } from "../memory/types.ts";
import { buildChatContext } from "../memory/context.ts";
import { scheduleMemoryJobs } from "../memory/jobs.ts";
import { beginForegroundChat } from "../memory/priority.ts";
import { recallChatMemory } from "../memory/recall.ts";
import { queueLearning, queueReflection } from "./background.ts";
import { readWeb, watchVideo } from "./materials.ts";
import { extractVideoTarget, type VideoService } from "../video/service.ts";
import { extractWebTarget, type WebService } from "../webpage/service.ts";
import { buildPersonaCore, CHARACTERS, DEFAULT_CHARACTER, withUserName, type CharacterId } from "../persona/persona.ts";
import type { ChatStore } from "../store/index.ts";

export const MAX_MESSAGE_CHARS = 2000;
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "video"; stage: "reading" | "watching" | "thinking" | "failed"; message: string; title?: string }
  | { type: "web"; stage: "reading" | "summarizing" | "failed"; message: string; title?: string }
  | { type: "emotion"; emotion: Emotion }
  | { type: "done"; messageId: number; sessionId: string; emotion: Emotion; provider?: string; usage?: LlmUsage; userMessageId?: number };

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
  /** B5：用户希望被称呼的名字；没设就传 null。 */
  nickname?: string | null;
  /** 客户端生成的消息 id：幂等去重、多端对账。 */
  clientId?: string;
  /** 实时事件总线；默认进程单例。 */
  bus?: EventBus;
  /** 记忆召回最长等待（毫秒）。 */
  recallTimeoutMs?: number;
  /** 降级链总等待上限：这么久没有第一个字就放弃并给出明确提示。 */
  firstTokenTimeoutMs?: number;
}

export class ChatInputError extends Error {}

/** 带可读分类的失败：前端据此显示「再试一次」和人话原因。 */
export class ChatFailure extends Error {
  readonly code: "timeout" | "model" | "empty";
  constructor(code: ChatFailure["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export const FIRST_TOKEN_TIMEOUT_MS = 25_000;

/** 广播给各端的消息形状：去掉裸列名 attachment_json。 */
function wire(message: object, attachment: unknown = null) {
  const { attachment_json: _raw, ...rest } = message as Record<string, unknown>;
  return { ...rest, attachment };
}

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
  const bus = deps.bus ?? hubEvents;
  const character = deps.character ?? DEFAULT_CHARACTER;
  const session = store.getOrCreateSession(character, deps.sessionId);
  const userMessage = store.add("user", userText, null, character, session.id);
  const streamId = `s${userMessage.id}`;
  const scope = { character, sessionId: session.id, clientId: deps.clientId };
  bus.publish("message.created", { ...scope, message: wire(userMessage) });
  bus.publish("typing", { ...scope, on: true });

  // 召回与后面的视频/网页阅读并行；向量检索最多等 1.5 秒，超时就不带召回结果。
  const recalling = recallChatMemory({ store, memory, character, sessionId: session.id, query: userText, timeoutMs: deps.recallTimeoutMs });
  recalling.catch(() => {});

  const filter = new EmotionFilter();
  let reply = "";
  let first: Emotion | undefined;
  let usedProvider: string | undefined;
  let usage: LlmUsage | undefined;
  let finished = false;

  // 降级链总等待上限：模型那边迟迟没有第一个字就放弃。
  // 计时从真正调用模型时开始；之前看视频、读网页可能要一两分钟，不算在里面。
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort(signal?.reason);
  if (signal?.aborted) inner.abort(signal.reason);
  else signal?.addEventListener("abort", onOuterAbort, { once: true });
  const firstTokenMs = deps.firstTokenTimeoutMs ?? FIRST_TOKEN_TIMEOUT_MS;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finishForegroundChat = beginForegroundChat();

  try {
    let situation: string | undefined;
    const videoTarget = deps.video ? extractVideoTarget(userText) : undefined;
    const webTarget = deps.web && !videoTarget ? extractWebTarget(userText) : undefined;
    if (deps.video && videoTarget) {
      situation = yield* watchVideo(deps, character, deps.video, videoTarget, session.id, userMessage.id, signal);
    } else if (deps.web && webTarget) {
      situation = yield* readWeb(deps, character, deps.web, webTarget, session.id, userMessage.id);
    }
    const recalled = await recalling;
    signal?.throwIfAborted();

    const messages = buildChatContext({
      persona: withUserName(buildPersonaCore(character), deps.nickname),
      core: recalled.core,
      observation: recalled.observation,
      memories: recalled.facts.slice(0, 8),
      topics: recalled.topics,
      experiences: recalled.experiences.slice(0, 5),
      learned: recalled.learned,
      note: store.getNote(character)?.text,
      situation,
      archive: recalled.archive,
      history: recalled.history,
      inputBudget: deps.inputBudget ?? 24_000,
    });

    const emit = function* (text: string, emotions: Emotion[]): Generator<ChatEvent> {
      for (const emotion of emotions) {
        first ??= emotion;
        yield { type: "emotion", emotion };
      }
      if (!reply) text = text.trimStart();
      if (text) {
        reply += text;
        bus.publish("message.delta", { ...scope, streamId, text });
        yield { type: "delta", text };
      }
    };

    timer = setTimeout(() => { timedOut = true; inner.abort(new Error("first-token-timeout")); }, firstTokenMs);
    try {
      for await (const delta of provider.stream(messages, { signal: inner.signal, firstTokenTimeoutMs: firstTokenMs })) {
        if (delta.provider) usedProvider = delta.provider;
        if (delta.usage) usage = delta.usage;
        if (delta.text) {
          clearTimeout(timer);
          const { text, emotions } = filter.feed(delta.text);
          yield* emit(text, emotions);
        }
      }
      yield* emit(filter.flush(), []);
    } catch (error) {
      if (timedOut && !reply) {
        throw new ChatFailure("timeout", `她这会儿一直没有回音（等了超过 ${Math.round(firstTokenMs / 1000)} 秒，几条线路都没接通）。可以再试一次。`);
      }
      throw error;
    }

    signal?.throwIfAborted();
    const emotion = first ?? "neutral";
    if (!reply.trim()) throw new ChatFailure("empty", "模型没有返回内容。");
    const saved = store.add("assistant", reply.trimEnd(), emotion, character, session.id);
    finished = true;
    try {
      store.recordCompletedInteraction?.({ userMessageId: userMessage.id, assistantMessageId: saved.id, character, emotion });
    } catch (error) {
      console.warn("关系进度更新失败：", error instanceof Error ? error.message : error);
    }
    store.enqueueMemoryJob({ sessionId: session.id, character, userMessageId: userMessage.id, assistantMessageId: saved.id });
    void scheduleMemoryJobs({ store, provider, memory });
    queueReflection(deps, character, false);
    bus.publish("message.created", { ...scope, streamId, message: wire(saved) });
    bus.publish("message.done", { ...scope, streamId, messageId: saved.id, emotion, provider: usedProvider });
    yield { type: "done", messageId: saved.id, sessionId: session.id, emotion, provider: usedProvider, usage, userMessageId: userMessage.id };
  } catch (error) {
    if (!finished) {
      if (reply.trim()) {
        // 说到一半被打断 / 中途出错：已经生成的部分照常入库，并标记 interrupted。
        const saved = store.add("assistant", reply.trimEnd(), first ?? "neutral", character, session.id);
        store.markInterrupted(saved.id);
        bus.publish("message.created", { ...scope, streamId, message: wire(saved, { type: "interrupted" }) });
        bus.publish("message.interrupted", { ...scope, streamId, messageId: saved.id, reason: signal?.aborted ? "aborted" : "error" });
      } else {
        // 一个字都没回出来：撤掉这条用户消息，重试时不会在历史里重复。
        store.remove(userMessage.id);
        bus.publish("message.interrupted", { ...scope, streamId, removedMessageId: userMessage.id, reason: signal?.aborted ? "aborted" : "error" });
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
    bus.publish("typing", { ...scope, on: false });
    finishForegroundChat();
    void scheduleMemoryJobs({ store, provider, memory });
  }
}
