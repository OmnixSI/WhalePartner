import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readJsonBody, sendJson } from "../http.ts";
import { createZip, type ZipEntry } from "../zip.ts";
import type { ServerDeps } from "../server-types.ts";

/**
 * 导出与「删除全部」（规范 §10.5 B2）——按 main 的 routes/* 结构实现。
 *
 * POST /api/export          生成一份 zip，返回 { id }
 * GET  /api/export?id=…     下载（application/zip）
 * DELETE /api/data          清空全部（必须 { confirm: "DELETE_ALL" }）
 *
 * 导出/删除进行中时，聊天请求会被拒绝（409），避免导出一半又被写入。
 */
const EXPORT_TTL_MS = 10 * 60_000;

interface ExportBundle {
  at: number;
  zip: Buffer;
  name: string;
}

const bundles = new Map<string, ExportBundle>();
let busy = false;

/** 聊天链路用：正在导出/删除时返回 true。 */
export function dataMaintenanceBusy(): boolean {
  return busy;
}

function json(data: unknown): Buffer {
  return Buffer.from(JSON.stringify(data, null, 2), "utf8");
}

function collect(deps: ServerDeps): ZipEntry[] {
  const { store } = deps;
  const sessions = store.listSessions("whale", 200);
  const entries: ZipEntry[] = [];
  entries.push({ name: "manifest.json", data: json({ app: "whalepartner", exportedAt: new Date().toISOString(), format: 1 }) });
  entries.push({
    name: "README.txt",
    data: Buffer.from("这是 WhalePartner 导出的数据：聊天记录、记忆、日记与用量。用任何支持 zip 的工具打开即可。\n", "utf8"),
  });
  entries.push({ name: "chat/sessions.json", data: json(sessions) });
  const messages = sessions.flatMap((session) => store.recent(500, "whale", session.id).map((message) => ({ ...message, sessionId: session.id })));
  entries.push({ name: "chat/messages.json", data: json(messages) });
  entries.push({ name: "memories/experiences.json", data: json(store.listExperiences(1000, false)) });
  entries.push({ name: "memories/facts.json", data: json(store.listFacts()) });
  return entries;
}

export async function handleExportRoute(
  deps: ServerDeps,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname === "/api/export" && request.method === "POST") {
    if (busy) return sendJson(response, 409, { error: "busy", message: "正在导出或删除，稍等一下。" }), true;
    busy = true;
    try {
      const zip = createZip(collect(deps));
      const id = randomUUID();
      bundles.set(id, { at: Date.now(), zip, name: `whalepartner-${new Date().toISOString().slice(0, 10)}.zip` });
      for (const [key, value] of bundles) if (Date.now() - value.at > EXPORT_TTL_MS) bundles.delete(key);
      sendJson(response, 201, { id });
    } catch {
      sendJson(response, 503, { error: "export_failed", message: "这次没打包成功，再试一次。" });
    } finally {
      busy = false;
    }
    return true;
  }

  if (url.pathname === "/api/export" && request.method === "GET") {
    const bundle = bundles.get(url.searchParams.get("id") ?? "");
    if (!bundle) {
      sendJson(response, 404, { error: "export_not_found", message: "这份打包已经过期，再导一次。" });
      return true;
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/zip");
    response.setHeader("content-disposition", `attachment; filename="${bundle.name}"`);
    response.setHeader("cache-control", "no-store");
    response.end(bundle.zip);
    return true;
  }

  if (url.pathname === "/api/data" && request.method === "DELETE") {
    if (busy) return sendJson(response, 409, { error: "busy", message: "正在导出或删除，稍等一下。" }), true;
    busy = true;
    try {
      const body = await readJsonBody(request);
      if (body?.confirm !== "DELETE_ALL") {
        sendJson(response, 400, { error: "confirm_required", message: "要删除全部，必须明确确认。" });
        return true;
      }
      deps.store.clear();
      sendJson(response, 200, { ok: true });
    } catch {
      sendJson(response, 503, { error: "delete_failed", message: "这次没删成功，再试一次。" });
    } finally {
      busy = false;
    }
    return true;
  }

  return false;
}
