import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, readJsonBody } from "../http.ts";
import { isCharacterId } from "../persona/persona.ts";
import type { EventBus } from "../events.ts";
import type { ChatStore } from "../store.ts";
import type { PresenceRegistry } from "../proactive/presence.ts";
import { CompanionSettingsError, validateCompanionSettingsPatch } from "../proactive/policy.ts";

const CLIENT_ID = /^[\w.-]{8,64}$/u;

export async function handleCompanionRoute(
  deps: { store: ChatStore; presence: PresenceRegistry; events: EventBus },
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname === "/api/companion/settings") {
    if (request.method === "GET") {
      sendJson(response, 200, deps.store.companionSettings());
      return true;
    }
    if (request.method === "PUT") {
      try {
        const body = await readJsonBody(request);
        const patch = validateCompanionSettingsPatch(body as Record<string, unknown>);
        const settings = deps.store.putCompanionSettings(patch);
        deps.events.publish("settings.updated", { scope: "companion" });
        sendJson(response, 200, settings);
      } catch (error) {
        sendJson(response, 400, {
          error: "invalid_settings",
          message: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof CompanionSettingsError ? error.message : "主动陪伴设置没存上。",
        });
      }
      return true;
    }
    sendJson(response, 405, { error: "method_not_allowed", message: "只支持 GET / PUT。" });
    return true;
  }

  if (request.method !== "POST" || url.pathname !== "/api/chat/presence") return false;
  try {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("在线状态格式不对。");
    const input = body as Record<string, unknown>;
    if (typeof input.clientId !== "string" || !CLIENT_ID.test(input.clientId)) throw new Error("设备标识无效。");
    if (!isCharacterId(input.character)) throw new Error("未知的角色。");
    for (const name of ["visible", "active", "busy", "voicePlaying"]) {
      if (typeof input[name] !== "boolean") throw new Error("在线状态格式不对。");
    }
    deps.presence.update({
      clientId: input.clientId,
      character: input.character,
      visible: input.visible as boolean,
      active: input.active as boolean,
      busy: input.busy as boolean,
      voicePlaying: input.voicePlaying as boolean,
    });
    response.writeHead(204).end();
  } catch (error) {
    sendJson(response, 400, { error: "invalid_presence", message: error instanceof Error ? error.message : "在线状态格式不对。" });
  }
  return true;
}
