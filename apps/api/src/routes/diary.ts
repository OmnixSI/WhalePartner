import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError } from "../chat.ts";
import { readJsonBody, sendJson } from "../http.ts";
import type { ServerDeps } from "../server-types.ts";
import { text } from "./input.ts";

export async function handleDiaryRoute(deps: Pick<ServerDeps, "diary">, request: IncomingMessage, response: ServerResponse, url: URL) {
  const diary = deps.diary;
  if (!diary) return sendJson(response, 503, { error: "日记功能未启用。" });
  try {
    if (request.method === "GET" && url.pathname === "/api/diary") {
      return sendJson(response, 200, { items: diary.list() });
    }
    if (request.method === "POST" && url.pathname === "/api/diary/queue") {
      const link = text((await readJsonBody(request)).url, 500, "url")!;
      try {
        const result = diary.enqueue(link);
        return sendJson(response, result.created ? 201 : 200, result);
      } catch (error) {
        throw new ChatInputError(error instanceof Error ? error.message : "视频链接无效。");
      }
    }
    if (request.method === "POST" && url.pathname === "/api/diary/run") {
      return sendJson(response, 202, { started: diary.trigger() });
    }
    const retry = /^\/api\/diary\/items\/(\d+)\/retry$/.exec(url.pathname);
    if (request.method === "POST" && retry) {
      const result = diary.retry(Number(retry[1]));
      if (result.result === "missing") return sendJson(response, 404, { error: "没有找到这篇日记或待看项。" });
      return sendJson(response, 202, result);
    }
    return sendJson(response, 404, { error: "未找到。" });
  } catch (error) {
    const status = error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
    return sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "日记请求失败。" });
  }
}
