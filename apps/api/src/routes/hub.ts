/** hub 路由：实时事件流、设备配对、设备管理。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { ChatInputError } from "../chat/service.ts";
import { attachEventStream, publishEvent, type EventBus } from "../hub/events.ts";
import { readJsonBody, sendJson, startSse } from "../server/http.ts";
import type { DeviceRegistry } from "../hub/devices.ts";
import { clientAddress } from "../hub/auth.ts";

export interface HubDeps {
  devices: DeviceRegistry;
  events: EventBus;
  port: number;
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

export async function handleHubRoute(deps: HubDeps, request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/api/events") {
    const header = request.headers["last-event-id"];
    const raw = (typeof header === "string" ? header : "") || url.searchParams.get("lastEventId") || "";
    const lastId = Number.parseInt(raw, 10);
    startSse(response);
    attachEventStream(deps.events, response, Number.isFinite(lastId) && lastId > 0 ? lastId : 0);
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
      if (!/^\d{6}$/.test(code)) throw new ChatInputError("配对码是 6 位数字。");
      const result = deps.devices.redeem(code, name, clientAddress(request, deps.trustedProxies));
      if (!result.ok) {
        sendJson(response, result.reason === "rate_limited" ? 429 : 400, {
          error: result.reason,
          message: result.reason === "rate_limited" ? "试得太频繁了，一分钟后再试。" : "配对码不对或已过期（10 分钟有效）。",
        });
        return true;
      }
      sendJson(response, 200, { token: result.token, device: result.device });
      publishEvent("settings.updated", { scope: "devices" });
    } catch (error) {
      const bad = error instanceof ChatInputError || error instanceof SyntaxError;
      sendJson(response, bad ? 400 : 500, { error: bad ? "bad_request" : "internal", message: bad ? (error as Error).message : "配对失败。" });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/devices") {
    sendJson(response, 200, { devices: deps.devices.list() });
    return true;
  }

  const match = /^\/api\/devices\/([^/]+)$/.exec(pathname);
  if (match && request.method === "DELETE") {
    const removed = deps.devices.revoke(decodeURIComponent(match[1]));
    if (!removed) sendJson(response, 404, { error: "没有这台设备。" });
    else {
      sendJson(response, 200, { ok: true });
      publishEvent("settings.updated", { scope: "devices" });
    }
    return true;
  }
  return false;
}
