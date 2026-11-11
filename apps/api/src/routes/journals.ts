import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError } from "../chat/service.ts";
import { isCharacterId } from "../persona/persona.ts";
import type { ServerDeps } from "../server/types.ts";
import { readJsonBody, RequestBodyError, sendJson } from "../server/http.ts";
import { text } from "./input.ts";

export async function handleJournalsRoute(deps: Pick<ServerDeps, "journal">, request: IncomingMessage, response: ServerResponse, url: URL) {
  const journal = deps.journal;
  if (!journal) return sendJson(response, 503, { error: "日记功能未启用。" });
  try {
    if (request.method === "GET" && url.pathname === "/api/journals") {
      const character = url.searchParams.get("character") ?? "whale";
      if (!isCharacterId(character)) throw new ChatInputError("未知的角色。");
      const from = readDate(url.searchParams.get("from"), "from");
      const to = readDate(url.searchParams.get("to"), "to");
      if (from && to && from > to) throw new ChatInputError("起始日期不能晚于结束日期。");
      const limit = readInteger(url.searchParams.get("limit"), 100, 1, 366, "limit");
      const offset = readInteger(url.searchParams.get("offset"), 0, 0, 1_000_000, "offset");
      return sendJson(response, 200, journal.list(character, { from, to, limit, offset }));
    }
    if (request.method === "POST" && url.pathname === "/api/journals/generate") {
      const body = await readJsonBody(request);
      const character = body.character ?? "whale";
      if (!isCharacterId(character)) throw new ChatInputError("未知的角色。");
      const localDate = body.date === undefined ? undefined : text(body.date, 10, "date");
      if (localDate) readDate(localDate, "date");
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
    const status = error instanceof RequestBodyError ? error.status : error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
    return sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "日记请求失败。" });
  }
}

function readDate(value: string | null, name: string) {
  if (value === null) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ChatInputError(`${name} 需要是有效的 YYYY-MM-DD 日期。`);
  }
  return value;
}

function readInteger(value: string | null, fallback: number, minimum: number, maximum: number, name: string) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ChatInputError(`${name} 超出允许范围。`);
  }
  return parsed;
}
