import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError } from "../chat/service.ts";
import { readJsonBody, RequestBodyError, sendJson } from "../server/http.ts";
import { waitForMemoryJobs } from "../memory/jobs.ts";
import { DEFAULT_CHARACTER, isCharacterId } from "../persona/persona.ts";
import type { ServerDeps } from "../server/types.ts";
import { text } from "./input.ts";
import type { ChatSessionRequests } from "./chat-session-requests.ts";
import { pauseBackgroundJobs, queueReflection } from "../chat/background.ts";
import type { CharacterId } from "../persona/persona.ts";

export async function handleChatHistoryRoute(
  deps: Pick<ServerDeps, "store" | "memory" | "provider" | "journal">,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  sessionRequests: ChatSessionRequests,
): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/chat/sessions") {
    const character = url.searchParams.get("character") ?? DEFAULT_CHARACTER;
    if (!isCharacterId(character)) {
      sendJson(response, 400, { error: "未知的角色。" });
      return true;
    }
    sendJson(response, 200, { sessions: deps.store.listSessions(character) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/chat/sessions") {
    try {
      const body = await readJsonBody(request);
      const character = body.character ?? DEFAULT_CHARACTER;
      if (!isCharacterId(character)) {
        sendJson(response, 400, { error: "未知的角色。" });
        return true;
      }
      const title = body.title === undefined ? "新聊天" : text(body.title, 40, "title")!;
      sendJson(response, 201, { session: deps.store.createSession(character, title) });
    } catch (error) {
      const status = error instanceof RequestBodyError ? error.status : error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
      sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "会话请求失败。" });
    }
    return true;
  }

  const sessionMatch = /^\/api\/chat\/sessions\/([^/]+)$/u.exec(url.pathname);
  if (sessionMatch && request.method === "PATCH") {
    try {
      const body = await readJsonBody(request);
      const character = body.character ?? DEFAULT_CHARACTER;
      if (!isCharacterId(character)) return sendJson(response, 400, { error: "未知的角色。" }), true;
      const title = text(body.title, 40, "title");
      if (!title) return sendJson(response, 400, { error: "聊天名称不能为空。" }), true;
      const session = deps.store.renameSession(decodeURIComponent(sessionMatch[1]), character, title);
      if (!session) sendJson(response, 404, { error: "没有找到这个角色的聊天会话。" });
      else sendJson(response, 200, { session });
    } catch (error) {
      const status = error instanceof RequestBodyError ? error.status : error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
      sendJson(response, status, { error: error instanceof Error ? error.message : "修改聊天名称失败。" });
    }
    return true;
  }

  if (sessionMatch && request.method === "DELETE") {
    const character = url.searchParams.get("character") ?? DEFAULT_CHARACTER;
    if (!isCharacterId(character)) {
      sendJson(response, 400, { error: "未知的角色。" });
      return true;
    }
    let sessionId: string;
    try {
      sessionId = decodeURIComponent(sessionMatch[1]);
    } catch {
      sendJson(response, 400, { error: "聊天会话标识无效。" });
      return true;
    }
    const unlock = await sessionRequests.lockForDeletion(sessionId);
    if (!unlock) {
      sendJson(response, 409, { error: "这个聊天会话正在删除。" });
      return true;
    }
    let unlockJournals = () => {};
    let unlockBackground = () => {};
    try {
      unlockBackground = await pauseBackgroundJobs();
      if (deps.journal) unlockJournals = await deps.journal.lockForSessionDeletion();
      await waitForMemoryJobs(deps.store);
      const deleted = deps.store.deleteSession(sessionId, character);
      if (!deleted) {
        sendJson(response, 404, { error: "没有找到这个角色的聊天会话。" });
        return true;
      }
      if (deleted.remainingAssistantCount > 0) {
        queueReflection({ provider: deps.provider, store: deps.store, memory: deps.memory }, character as CharacterId, true);
      }
      let memoriesCleared = true;
      if (deps.memory) {
        for (const id of [...deleted.experienceVectorIds, ...deleted.legacyVectorIds]) {
          try {
            await deps.memory.remove(id);
          } catch (error) {
            memoriesCleared = false;
            console.warn("会话记忆向量清理失败：", error instanceof Error ? error.message : error);
          }
        }
      }
      unlockJournals();
      for (const affected of deleted.affectedJournals) {
        try {
          const author = affected.character === "shared" ? DEFAULT_CHARACTER : affected.character as CharacterId;
          await deps.journal?.generate(author, affected.localDate);
        } catch (error) {
          console.warn("删除会话后重写日记失败：", error instanceof Error ? error.message : error);
        }
      }
      sendJson(response, 200, { ok: true, memoriesCleared, remainingAssistantCount: deleted.remainingAssistantCount });
    } finally {
      unlockJournals();
      unlockBackground();
      unlock();
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/chat/history") {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const character = url.searchParams.get("character") ?? DEFAULT_CHARACTER;
    if (!isCharacterId(character)) {
      sendJson(response, 400, { error: "未知的角色。" });
      return true;
    }
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    if (sessionId && !deps.store.getSession(sessionId)) {
      sendJson(response, 404, { error: "没有找到这个聊天会话。" });
      return true;
    }
    const aroundId = Number(url.searchParams.get("aroundId")) || undefined;
    if (aroundId && !sessionId) {
      sendJson(response, 400, { error: "定位聊天原文需要指定会话。" });
      return true;
    }
    const around = aroundId && sessionId ? deps.store.messagesAround(sessionId, aroundId) : undefined;
    if (aroundId && !around) {
      sendJson(response, 404, { error: "没有找到这条聊天原文。" });
      return true;
    }
    sendJson(response, 200, { messages: around ?? deps.store.recent(limit, undefined, sessionId) });
    return true;
  }

  if (request.method === "DELETE" && url.pathname === "/api/chat/history") {
    const unlockBackground = await pauseBackgroundJobs();
    let unlockRequests = () => {};
    let unlockJournals = () => {};
    try {
      const unlock = await sessionRequests.lockForHistoryClear();
      if (!unlock) {
        sendJson(response, 409, { error: "聊天记录正在变更，请稍后重试。" });
        return true;
      }
      unlockRequests = unlock;
      if (deps.journal) unlockJournals = await deps.journal.lockForSessionDeletion();
      await waitForMemoryJobs(deps.store);
      const vectorIds = [...deps.store.factVectorIds(), ...deps.store.chatDerivedExperienceVectorIds()];
      deps.store.clear();
      let memoriesCleared = true;
      if (deps.memory) {
        for (const id of vectorIds) {
          try {
            await deps.memory.remove(id);
          } catch (error) {
            memoriesCleared = false;
            console.warn("向量记忆清理失败：", error instanceof Error ? error.message : error);
          }
        }
        try {
          for (const entry of await deps.memory.list()) {
            if (entry.kind === "fact" || (entry.source === "learned" && (entry.sourceId?.startsWith("chat:") || entry.sourceId?.startsWith("learned:chat:")))) {
              try {
                await deps.memory.remove(entry.id);
              } catch (error) {
                memoriesCleared = false;
                console.warn("历史事实清理失败：", error instanceof Error ? error.message : error);
              }
            }
          }
        } catch (error) {
          memoriesCleared = false;
          console.warn("聊天历史已清除，但未能读取剩余向量记忆：", error instanceof Error ? error.message : error);
        }
      }
      sendJson(response, 200, { ok: true, memoriesCleared });
    } finally {
      unlockJournals();
      unlockRequests();
      unlockBackground();
    }
    return true;
  }

  return false;
}
