import { msg } from "../i18n/index.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, readJsonBody, RequestBodyError } from "../server/http.ts";
import { isCharacterId } from "../persona/persona.ts";
import type { EventBus } from "../hub/events.ts";
import type { ChatStore } from "../store/index.ts";
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
        sendJson(response, error instanceof RequestBodyError ? error.status : 400, {
          error: "invalid_settings",
          message: error instanceof SyntaxError ? msg().core.shared.invalidJson : error instanceof CompanionSettingsError ? error.message : msg().core.routes.companion.notSaved,
        });
      }
      return true;
    }
    sendJson(response, 405, { error: "method_not_allowed", message: msg().core.shared.onlyGetPut });
    return true;
  }

  if (request.method !== "POST" || url.pathname !== "/api/chat/presence") return false;
  try {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(msg().core.routes.companion.presenceFormat);
    const input = body as Record<string, unknown>;
    if (typeof input.clientId !== "string" || !CLIENT_ID.test(input.clientId)) throw new Error(msg().core.routes.companion.deviceIdInvalid);
    if (!isCharacterId(input.character)) throw new Error(msg().common.unknownCharacter);
    for (const name of ["visible", "active", "busy", "voicePlaying"]) {
      if (typeof input[name] !== "boolean") throw new Error(msg().core.routes.companion.presenceFormat);
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
    sendJson(response, error instanceof RequestBodyError ? error.status : 400, { error: "invalid_presence", message: error instanceof Error ? error.message : msg().core.routes.companion.presenceFormat });
  }
  return true;
}
