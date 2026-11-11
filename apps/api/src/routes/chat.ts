import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatFailure, ChatInputError, runChat, validateUserMessage } from "../chat/service.ts";
import { ClientIdLedger, SessionMutex } from "./session-lock.ts";
import { readUserName } from "./profile.ts";
import { quotaUsage } from "./quota.ts";
import { readJsonBody, sendJson, sendSse, startSse } from "../server/http.ts";
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from "../persona/persona.ts";
import type { ServerDeps } from "../server/types.ts";
import type { ChatSessionRequests } from "./chat-session-requests.ts";
import type { DeviceConnections } from "../hub/device-connections.ts";

const mutex = new SessionMutex();
const ledger = new ClientIdLedger();
const HEARTBEAT_MS = () => Number(process.env.WP_CHAT_HEARTBEAT_MS) || 10_000;

export async function handleChatRoute(
  deps: Pick<ServerDeps, "config" | "provider" | "store" | "memory" | "video" | "web" | "events">,
  request: IncomingMessage,
  response: ServerResponse,
  sessionRequests: ChatSessionRequests,
  device?: { connections?: DeviceConnections; deviceId?: string },
) {
  let text: string;
  let character: CharacterId = DEFAULT_CHARACTER;
  let sessionId: string | undefined;
  let clientId: string | undefined;
  try {
    const body = await readJsonBody(request);
    text = validateUserMessage(body.message);
    if (body.character !== undefined) {
      if (!isCharacterId(body.character)) throw new ChatInputError("未知的角色。");
      character = body.character;
    }
    if (body.sessionId !== undefined) {
      if (typeof body.sessionId !== "string" || body.sessionId.length > 64) throw new ChatInputError("聊天会话标识无效。");
      sessionId = body.sessionId;
    }
    if (body.clientId !== undefined) {
      if (typeof body.clientId !== "string" || !/^[\w.-]{8,64}$/u.test(body.clientId)) throw new ChatInputError("clientId 无效。");
      clientId = body.clientId;
    }
  } catch (error) {
    const status = error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : (error as Error).message });
    return;
  }

  let activeSessionId: string;
  try {
    activeSessionId = deps.store.getOrCreateSession(character, sessionId).id;
    sessionId = activeSessionId;
  } catch (error) {
    sendJson(response, 404, { error: error instanceof Error ? error.message : "没有找到这个聊天会话。" });
    return;
  }

  // 幂等：同一个 clientId 已经成功 → 不重复生成，直接回放结果；还在进行 → 409。
  if (clientId) {
    const seen = ledger.get(clientId);
    if (seen?.state === "done") {
      startSse(response);
      sendSse(response, "ack", { clientId, sessionId: activeSessionId, duplicate: true });
      sendSse(response, "done", { messageId: seen.messageId, userMessageId: seen.userMessageId, sessionId: activeSessionId, emotion: "neutral", duplicate: true });
      response.end();
      return;
    }
    if (seen?.state === "running") {
      sendJson(response, 409, { error: "duplicate", message: "这句话已经在发送了。" });
      return;
    }
  }

  const abort = new AbortController();
  const finishRequest = sessionRequests.begin(activeSessionId, abort);
  if (!finishRequest) {
    sendJson(response, 409, { error: "这个聊天会话正在删除，请稍后重试。" });
    return;
  }
  response.on("close", () => {
    if (!response.writableFinished) abort.abort();
  });
  // 撤销设备时：先中止生成，再直接掐断连接，撤销之后不会再写出任何正文。
  const unregister = device?.connections?.add(device.deviceId, () => {
    abort.abort();
    response.destroy();
  });
  if (unregister) response.on("close", unregister);

  // B1：开启拦截后，额度用完直接 402，不开流也不写用户消息。
  const quota = quotaUsage(deps.config.dbPath);
  if (quota.enforced && quota.used >= quota.total) {
    sendJson(response, 402, { error: "quota_exceeded", message: "这个月的贝壳用完了，下个月 1 号再来找我。" });
    finishRequest();
    return;
  }

  if (clientId) ledger.begin(clientId, activeSessionId);
  // 立刻回 ack，让前端马上进入「她在想」；之后每 10 秒一次心跳，防止中间层掐线。
  startSse(response);
  sendSse(response, "ack", { clientId, sessionId: activeSessionId, queued: mutex.isBusy(activeSessionId) });
  const beat = setInterval(() => sendSse(response, "ping", { t: Date.now() }), HEARTBEAT_MS());
  beat.unref?.();
  let release: (() => void) | undefined;
  try {
    release = await mutex.acquire(activeSessionId, abort.signal);
    for await (const event of runChat({
      provider: deps.provider,
      store: deps.store,
      memory: deps.memory,
      character,
      sessionId,
      clientId,
      bus: deps.events,
      inputBudget: Math.max(8_000, deps.config.chatContextTokens - 8_000),
      video: deps.video,
      web: deps.web,
      // B5：昵称注入人格提示。
      nickname: readUserName(deps.config.dbPath),
    }, text, abort.signal)) {
      if (event.type === "done" && clientId) ledger.done(clientId, event.messageId, event.userMessageId);
      const { type, ...data } = event;
      sendSse(response, type, data);
    }
  } catch (error) {
    if (clientId) ledger.forget(clientId);
    if (!abort.signal.aborted) {
      const code = error instanceof ChatFailure ? error.code : "model";
      sendSse(response, "error", { message: error instanceof Error ? error.message : "聊天失败。", code });
    }
  } finally {
    clearInterval(beat);
    release?.();
    response.end();
    finishRequest();
  }
}
