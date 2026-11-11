import type { IncomingMessage, ServerResponse } from "node:http";
import { ChatInputError } from "../chat/service.ts";
import { readJsonBody, RequestBodyError, sendJson } from "../server/http.ts";
import { archiveExperience } from "../memory/archive.ts";
import type { ServerDeps } from "../server/types.ts";
import { sharedParagraph, summarizeVideo, VideoError } from "../video/service.ts";
import { text } from "./input.ts";

export async function handleVideoSummaryRoute(
  deps: Pick<ServerDeps, "video" | "memory" | "store">,
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (!deps.video) return sendJson(response, 503, { error: "视频功能未启用。" });
  try {
    const url = text((await readJsonBody(request)).url, 500, "url")!;
    const result = await summarizeVideo(deps.video, url);
    await archiveExperience(deps.store, deps.memory, { kind: "video", title: result.title, text: sharedParagraph(result.summary), url: result.url, sourceId: result.bvid }, "视频经历");
    const remembered = true;
    return sendJson(response, 200, { video: result, remembered });
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : error instanceof ChatInputError || error instanceof SyntaxError ? 400 : error instanceof VideoError ? 502 : 500;
    return sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "视频处理失败。" });
  }
}
