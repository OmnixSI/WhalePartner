/** hub 路由：实时事件流、设备配对、设备管理。 */
import { msg } from "../i18n/index.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { ChatInputError } from "../chat/service.ts";
import { attachEventStream, publishEvent, type EventBus } from "../hub/events.ts";
import { readJsonBody, RequestBodyError, sendJson, startSse } from "../server/http.ts";
import type { DeviceRegistry } from "../hub/devices.ts";
import type { DeviceConnections } from "../hub/device-connections.ts";
import { clientAddress } from "../hub/auth.ts";

export interface HubDeps {
  devices: DeviceRegistry;
  events: EventBus;
  port: number;
  connections?: DeviceConnections;
  /** 额外可信的代理网段（本机回环总是可信）。 */
  trustedProxies?: string[];
}

function lanAddresses(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) out.push(`http://${item.address}:${port}`);
    }
  }
  return out;
}

export async function handleHubRoute(deps: HubDeps, request: IncomingMessage, response: ServerResponse, url: URL, deviceId?: string): Promise<boolean> {
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/api/events") {
    const header = request.headers["last-event-id"];
    const raw = (typeof header === "string" ? header : "") || url.searchParams.get("lastEventId") || "";
    const lastId = Number.parseInt(raw, 10);
    startSse(response);
    const detach = attachEventStream(deps.events, response, Number.isFinite(lastId) && lastId > 0 ? lastId : 0);
    const unregister = deps.connections?.add(deviceId, () => {
      detach();
      response.end();
    });
    if (unregister) response.on("close", unregister);
    return true;
  }

  if (request.method === "POST" && pathname === "/api/pair/create") {
    const { code, expiresAt } = deps.devices.createPairingCode();
    sendJson(response, 200, { code, expiresAt, addresses: lanAddresses(deps.port) });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/pair/redeem") {
    try {
      const body = await readJsonBody(request);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const name = typeof body.name === "string" ? body.name : "";
      if (!/^\d{6}$/.test(code)) throw new ChatInputError(msg().core.routes.hub.codeFormat);
      const result = deps.devices.redeem(code, name, clientAddress(request, deps.trustedProxies));
      if (!result.ok) {
        sendJson(response, result.reason === "rate_limited" ? 429 : 400, {
          error: result.reason,
          message: result.reason === "rate_limited" ? msg().core.routes.hub.rateLimited : msg().core.routes.hub.codeWrong,
        });
        return true;
      }
      sendJson(response, 200, { token: result.token, device: result.device });
      publishEvent("settings.updated", { scope: "devices" });
    } catch (error) {
      const bad = error instanceof ChatInputError || error instanceof SyntaxError || error instanceof RequestBodyError;
      sendJson(response, error instanceof RequestBodyError ? error.status : bad ? 400 : 500, { error: bad ? "bad_request" : "internal", message: bad ? (error as Error).message : msg().core.routes.hub.pairFailed });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/devices") {
    sendJson(response, 200, { devices: deps.devices.list() });
    return true;
  }

  const match = /^\/api\/devices\/([^/]+)$/.exec(pathname);
  if (match && request.method === "DELETE") {
    const id = decodeURIComponent(match[1]);
    const removed = deps.devices.revoke(id);
    if (!removed) sendJson(response, 404, { error: msg().core.routes.hub.deviceNotFound });
    else {
      // 已建立的长连接不会重新鉴权，撤销后要主动断开这台设备的全部事件流和 WebSocket。
      deps.connections?.closeDevice(id);
      sendJson(response, 200, { ok: true });
      publishEvent("settings.updated", { scope: "devices" });
    }
    return true;
  }
  return false;
}
