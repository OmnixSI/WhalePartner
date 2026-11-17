import { msg } from "../i18n/index.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError } from "../chat/service.ts";
import { isCharacterId } from "../persona/persona.ts";
import type { ServerDeps } from "../server/types.ts";
import { readJsonBody, RequestBodyError, sendJson } from "../server/http.ts";
import { text } from "./input.ts";

export async function handleJournalsRoute(deps: Pick<ServerDeps, "journal">, request: IncomingMessage, response: ServerResponse, url: URL) {
  const journal = deps.journal;
  if (!journal) return sendJson(response, 503, { error: msg().core.shared.diaryDisabled });
  try {
    if (request.method === "GET" && url.pathname === "/api/journals") {
      const character = url.searchParams.get("character") ?? "whale";
      if (!isCharacterId(character)) throw new ChatInputError(msg().common.unknownCharacter);
      const from = readDate(url.searchParams.get("from"), "from");
      const to = readDate(url.searchParams.get("to"), "to");
      if (from && to && from > to) throw new ChatInputError(msg().core.routes.journals.rangeOrder);
      const limit = readInteger(url.searchParams.get("limit"), 100, 1, 366, "limit");
      const offset = readInteger(url.searchParams.get("offset"), 0, 0, 1_000_000, "offset");
      return sendJson(response, 200, journal.list(character, { from, to, limit, offset }));
    }
    if (request.method === "POST" && url.pathname === "/api/journals/generate") {
      const body = await readJsonBody(request);
      const character = body.character ?? "whale";
      if (!isCharacterId(character)) throw new ChatInputError(msg().common.unknownCharacter);
      const localDate = body.date === undefined ? undefined : text(body.date, 10, "date");
      if (localDate) readDate(localDate, "date");
      if (body.force !== undefined && typeof body.force !== "boolean") throw new ChatInputError(msg().core.routes.journals.forceBool);
      const current = await journal.generate(character, localDate, body.force === true);
      return sendJson(response, 200, current ? { journal: current } : { journal: null, reason: "no_sources" });
    }
    const revisions = /^\/api\/journals\/(.+)\/revisions$/u.exec(url.pathname);
    if (request.method === "GET" && revisions) {
      const id = decodeURIComponent(revisions[1]);
      return sendJson(response, 200, { revisions: journal.revisions(id) });
    }
    return sendJson(response, 404, { error: msg().core.shared.notFound });
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
    return sendJson(response, status, { error: error instanceof SyntaxError ? msg().core.shared.invalidJson : error instanceof Error ? error.message : msg().core.routes.diary.requestFailed });
  }
}

function readDate(value: string | null, name: string) {
  if (value === null) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ChatInputError(msg().core.routes.journals.dateFormat(name));
  }
  return value;
}

function readInteger(value: string | null, fallback: number, minimum: number, maximum: number, name: string) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ChatInputError(msg().core.routes.journals.dateOutOfRange(name));
  }
  return parsed;
}
