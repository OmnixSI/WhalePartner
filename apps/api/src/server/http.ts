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

/**
 * 预检放行的方法，必须**覆盖前端实际发的每一个**。
 *
 * 0.2.3 的坑：这一行只写了 GET/POST/PATCH/DELETE，而昵称、模型接入、逛设置
 * 三个接口是 PUT。开发时页面走 Vite 代理（同源、没有预检），全绿；装成桌面
 * App 之后页面来自 `tauri://localhost`，跨源预检被这句话拦掉，fetch 直接抛
 * `TypeError: Load failed`，开关点了又弹回去。
 *
 * 改这张表之前先跑 `test/cors.test.ts`：它会扫前端源码里所有 `method: "X"`，
 * 漏一个就红。
 */
export const CORS_ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

export const CORS_ALLOWED_ORIGINS: readonly string[] = [...ALLOWED_ORIGINS];

export function applyCors(request: IncomingMessage, response: ServerResponse, extraOrigins: readonly string[] = []) {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !(ALLOWED_ORIGINS.has(origin) || extraOrigins.includes(origin))) return;
  // 预检里浏览器会列出它想问的请求头；原样回显比写死一张表更不容易再漏。
  const asked = request.headers["access-control-request-headers"];
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "origin");
  response.setHeader("access-control-allow-methods", CORS_ALLOWED_METHODS.join(","));
  response.setHeader("access-control-allow-headers", typeof asked === "string" && asked.trim() ? asked : "content-type");
  // 预检结果缓存 10 分钟，省掉每次改设置都多一个来回。
  response.setHeader("access-control-max-age", "600");
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export type RequestBodyErrorCode = "invalid_json" | "invalid_body" | "body_too_large";

/** 请求体问题带明确状态码：400 是格式/类型不对，413 是超过 64 KB。 */
export class RequestBodyError extends Error {
  readonly status: 400 | 413;
  readonly code: RequestBodyErrorCode;

  constructor(status: 400 | 413, code: RequestBodyErrorCode, message: string) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
    this.code = code;
  }
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      // 继续把请求读完再回 413；中途抛错会销毁连接，客户端就收不到响应了。
      tooLarge = true;
      chunks.length = 0;
    } else if (!tooLarge) {
      chunks.push(buffer);
    }
  }
  if (tooLarge) throw new RequestBodyError(413, "body_too_large", "请求内容过大（最多 64 KB）。");
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RequestBodyError(400, "invalid_json", "请求体不是有效的 JSON。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestBodyError(400, "invalid_body", "请求体必须是 JSON 对象。");
  }
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
