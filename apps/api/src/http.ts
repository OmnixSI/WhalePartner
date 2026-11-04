import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 64 * 1024;

/** 允许调用本机 API 的来源：Tauri 窗口和本地 Vite 开发页。局域网联调走 Vite 代理，不需要放开。 */
const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
]);

export function applyCors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
    response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
  }
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("请求内容过大。");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("请求体必须是 JSON 对象。");
  return parsed as Record<string, unknown>;
}

export function startSse(response: ServerResponse) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders();
}

export function sendSse(response: ServerResponse, event: string, data: unknown) {
  if (response.writableEnded || response.destroyed) return;
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
