import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError } from "../chat.ts";
import { readJsonBody, sendJson } from "../http.ts";
import { waitForMemoryJobs } from "../memory/jobs.ts";
import { DEFAULT_CHARACTER, isCharacterId } from "../persona/persona.ts";
import type { ServerDeps } from "../server-types.ts";
import { text } from "./input.ts";

export async function handleChatHistoryRoute(
  deps: Pick<ServerDeps, "store" | "memory">,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
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
      const status = error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
      sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "会话请求失败。" });
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
    if (sessionId && !deps.store.getSession(sessionId, character)) {
      sendJson(response, 404, { error: "没有找到这个角色的聊天会话。" });
      return true;
    }
    sendJson(response, 200, { messages: deps.store.recent(limit, character, sessionId) });
    return true;
  }

  if (request.method === "DELETE" && url.pathname === "/api/chat/history") {
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
    return true;
  }

  return false;
}
