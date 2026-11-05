import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError } from "../chat.ts";
import { isCharacterId } from "../persona/persona.ts";
import type { ServerDeps } from "../server-types.ts";
import { readJsonBody, sendJson } from "../http.ts";
import { text } from "./input.ts";

export async function handleJournalsRoute(deps: Pick<ServerDeps, "journal">, request: IncomingMessage, response: ServerResponse, url: URL) {
  const journal = deps.journal;
  if (!journal) return sendJson(response, 503, { error: "日记功能未启用。" });
  try {
    if (request.method === "GET" && url.pathname === "/api/journals") {
      const character = url.searchParams.get("character") ?? "whale";
      if (!isCharacterId(character)) throw new ChatInputError("未知的角色。");
      return sendJson(response, 200, { items: journal.list(character) });
    }
    if (request.method === "POST" && url.pathname === "/api/journals/generate") {
      const body = await readJsonBody(request);
      const character = body.character ?? "whale";
      if (!isCharacterId(character)) throw new ChatInputError("未知的角色。");
      const localDate = body.date === undefined ? undefined : text(body.date, 10, "date");
      if (localDate && !/^\d{4}-\d{2}-\d{2}$/u.test(localDate)) throw new ChatInputError("日期格式需要是 YYYY-MM-DD。");
      if (body.force !== undefined && typeof body.force !== "boolean") throw new ChatInputError("force 必须是布尔值。");
      const current = await journal.generate(character, localDate, body.force === true);
      return sendJson(response, 200, current ? { journal: current } : { journal: null, reason: "no_sources" });
    }
    const revisions = /^\/api\/journals\/(.+)\/revisions$/u.exec(url.pathname);
    if (request.method === "GET" && revisions) {
      const id = decodeURIComponent(revisions[1]);
      return sendJson(response, 200, { revisions: journal.revisions(id) });
    }
    return sendJson(response, 404, { error: "未找到。" });
  } catch (error) {
    const status = error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
    return sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "日记请求失败。" });
  }
}
