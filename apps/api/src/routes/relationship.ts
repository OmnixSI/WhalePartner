import type { IncomingMessage, ServerResponse } from "node:http";
import { isCharacterId } from "../persona/persona.ts";
import type { ServerDeps } from "../server/types.ts";
import { sendJson } from "../server/http.ts";

export function handleRelationshipRoute(deps: Pick<ServerDeps, "store">, request: IncomingMessage, response: ServerResponse, url: URL): boolean {
  if (url.pathname !== "/api/relationship") return false;
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed", message: "只支持 GET。" });
    return true;
  }
  const character = url.searchParams.get("character") ?? "deepseek";
  if (!isCharacterId(character)) {
    sendJson(response, 400, { error: "invalid_character", message: "未知的角色。" });
    return true;
  }
  sendJson(response, 200, deps.store.relationshipSnapshot(character));
  return true;
}
