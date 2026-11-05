import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError, runChat, validateUserMessage } from "../chat.ts";
import { readJsonBody, sendJson, sendSse, startSse } from "../http.ts";
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from "../persona/persona.ts";
import type { ServerDeps } from "../server-types.ts";

export async function handleChatRoute(
  deps: Pick<ServerDeps, "config" | "provider" | "store" | "memory" | "video" | "web">,
  request: IncomingMessage,
  response: ServerResponse,
) {
  let text: string;
  let character: CharacterId = DEFAULT_CHARACTER;
  let sessionId: string | undefined;
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
  } catch (error) {
    const status = error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : (error as Error).message });
    return;
  }

  const abort = new AbortController();
  response.on("close", () => {
    if (!response.writableFinished) abort.abort();
  });

  startSse(response);
  try {
    for await (const event of runChat({
      provider: deps.provider,
      store: deps.store,
      memory: deps.memory,
      character,
      sessionId,
      inputBudget: Math.max(8_000, deps.config.chatContextTokens - 8_000),
      video: deps.video,
      web: deps.web,
    }, text, abort.signal)) {
      const { type, ...data } = event;
      sendSse(response, type, data);
    }
  } catch (error) {
    if (!abort.signal.aborted) sendSse(response, "error", { message: error instanceof Error ? error.message : "聊天失败。" });
  } finally {
    response.end();
  }
}
