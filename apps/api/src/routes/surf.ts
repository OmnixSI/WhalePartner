import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, readJsonBody, sendSse, startSse } from "../server/http.ts";
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from "../persona/persona.ts";
import { validateSettingsPatch } from "../surf/settings.ts";
import type { SurfService } from "../surf/service.ts";
import type { SurfEventName } from "../surf/events.ts";
import type { SurfItemKind } from "../surf/types.ts";
import type { DeviceConnections } from "../hub/device-connections.ts";

/** 「她自己去逛」的接口（§10.6.10）。所有 character 缺省取默认角色，非法 id → 400。 */
export interface SurfRouteDeps {
  surf?: SurfService;
  connections?: DeviceConnections;
}

const BAD_CHARACTER = { error: "未知的角色。" };

function characterOf(url: URL, response: ServerResponse): CharacterId | null {
  const raw = url.searchParams.get("character");
  if (raw === null || raw === "") return DEFAULT_CHARACTER;
  if (!isCharacterId(raw)) {
    sendJson(response, 400, BAD_CHARACTER);
    return null;
  }
  return raw;
}

function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const param = url.searchParams.get(name);
  if (param === null || param.trim() === "") return fallback;
  const raw = Number(param);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

export async function handleSurf(
  deps: SurfRouteDeps,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deviceId?: string,
): Promise<void> {
  const surf = deps.surf;
  if (!surf) {
    sendJson(response, 503, { error: "「她自己去逛」还没有启用。" });
    return;
  }

  // 缩略图不需要角色参数：id 全局唯一。
  const thumb = /^\/api\/surf\/thumb\/(\d+)$/.exec(url.pathname);
  if (thumb && request.method === "GET") {
    const found = surf.thumbPath(Number(thumb[1]));
    if (!found) return sendJson(response, 404, { error: "没有这张图。" });
    response.writeHead(200, {
      "content-type": found.mime,
      "cache-control": "private, max-age=86400",
    });
    createReadStream(found.path)
      .on("error", () => {
        if (!response.headersSent) sendJson(response, 404, { error: "没有这张图。" });
        else response.end();
      })
      .pipe(response);
    return;
  }

  const character = characterOf(url, response);
  if (!character) return;

  if (request.method === "GET" && url.pathname === "/api/surf/settings") {
    const status = await surf.status(character);
    sendJson(response, 200, { ...surf.settings(character), webAvailable: status.webAvailable, browser: status.browser });
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/surf/settings") {
    try {
      const body = await readJsonBody(request);
      const patch = validateSettingsPatch(body);
      const saved = surf.putSettings(character, patch);
      const status = await surf.status(character);
      sendJson(response, 200, { ...saved, webAvailable: status.webAvailable, browser: status.browser });
    } catch (error) {
      sendJson(response, 400, {
        error: "invalid_settings",
        message: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "设置不对。",
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/surf/status") {
    sendJson(response, 200, await surf.status(character));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/surf/run") {
    const check = surf.canRunNow(character, { manual: true });
    if (!check.ok) {
      if (check.code === "too_soon") return sendJson(response, 429, { error: "too_soon", message: check.message });
      if (check.code === "already_running") return sendJson(response, 409, { error: "already_running", message: check.message });
      if (check.code === "quota") return sendJson(response, 402, { error: "quota", message: check.message });
      return sendJson(response, 200, { state: "skipped", reason: check.code ?? "disabled", message: check.message });
    }
    // 立刻回 202：会话在后台跑，进度走 SSE。sessionId 从刚插进去的那一行取。
    const pending = surf.run(character, { manual: true });
    const running = surf.store.runningSession(character);
    pending.catch((error: unknown) => console.warn("手动冲浪失败：", error instanceof Error ? error.message : error));
    sendJson(response, 202, { sessionId: running?.id ?? null, character });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/surf/feed") {
    const kindRaw = url.searchParams.get("kind");
    const kind: SurfItemKind | undefined = kindRaw === "video" || kindRaw === "web" ? kindRaw : undefined;
    const page = intParam(url, "page", 1, 1, 1000);
    const pageSize = intParam(url, "pageSize", 20, 1, 50);
    const q = url.searchParams.get("q") ?? undefined;
    const site = url.searchParams.get("site")?.trim().slice(0, 80) || undefined;
    const time = (name: string) => {
      const raw = url.searchParams.get(name);
      const parsed = raw ? Date.parse(raw) : Number.NaN;
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
    };
    const result = surf.feed({ character, kind, page, pageSize, q, site, from: time("from"), to: time("to") });
    sendJson(response, 200, { ...result, page, pageSize, sources: surf.store.sources() });
    return;
  }

  const single = /^\/api\/surf\/items\/(\d+)$/.exec(url.pathname);
  if (single) {
    const id = Number(single[1]);
    if (request.method === "GET") {
      const item = surf.item(id);
      if (!item) return sendJson(response, 404, { error: "没有这条见闻。" });
      sendJson(response, 200, {
        id: item.id,
        kind: item.kind,
        title: item.title,
        url: item.url,
        sourceSite: item.sourceSite,
        thumb: item.thumbPath ? `/api/surf/thumb/${item.id}` : null,
        thumbError: item.thumbError,
        summary: item.summary,
        comment: item.comment,
        tags: item.tags,
        createdAt: item.createdAt,
        sharedAt: item.sharedAt,
      });
      return;
    }
    if (request.method === "DELETE") {
      const removed = await surf.forget(id);
      if (!removed) return sendJson(response, 404, { error: "没有这条见闻。" });
      response.writeHead(204).end();
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/surf/events") {
    startSse(response);
    const unsubscribe = surf.bus.subscribe(character, (event: SurfEventName, data: unknown) => {
      sendSse(response, event, data);
    });
    // 20 秒一帧注释心跳，防止中间层掐断（测试用 SURF_SSE_HEARTBEAT_MS 调快）。
    const heartbeatMs = Number(process.env.SURF_SSE_HEARTBEAT_MS) || 20_000;
    const beat = setInterval(() => {
      if (response.writableEnded || response.destroyed) return;
      response.write(": ping\n\n");
    }, heartbeatMs);
    beat.unref?.();
    const done = () => {
      clearInterval(beat);
      unsubscribe();
    };
    response.on("close", done);
    response.on("error", done);
    const unregister = deps.connections?.add(deviceId, () => {
      done();
      response.end();
    });
    if (unregister) response.on("close", unregister);
    return;
  }

  sendJson(response, 404, { error: "未找到。" });
}

/** 给 GET /api/chat/history 用：把助手消息上的明信片附件补回来（§10.6.6）。 */
export function attachmentFor(surf: SurfService | undefined, messageId: number): Record<string, unknown> | undefined {
  return surf?.attachmentOf(messageId);
}
