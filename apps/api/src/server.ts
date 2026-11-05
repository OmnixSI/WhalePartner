import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadConfig, type ApiConfig } from "./config.ts";
import { ChatInputError, runChat, validateUserMessage } from "./chat.ts";
import { applyCors, readJsonBody, sendJson, sendSse, startSse } from "./http.ts";
import { createChatProvider } from "./llm/index.ts";
import type { FallbackChatProvider } from "./llm/router.ts";
import { LazyMemoryStore } from "./memory/mem0.ts";
import type { MemoryStatus, MemoryStore } from "./memory/types.ts";
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from "./persona/persona.ts";
import { ChatStore } from "./store.ts";
import { createVideoService, sharedParagraph, summarizeVideo, VideoError, type VideoService } from "./video-service.ts";
import { createWebService, type WebService } from "./web-service.ts";
import { DiaryStore } from "./diary-store.ts";
import { DiaryService } from "./diary-service.ts";
import { startDiaryScheduler } from "./diary-scheduler.ts";

export interface ServerDeps {
  config: ApiConfig;
  provider: FallbackChatProvider;
  store: ChatStore;
  memory?: MemoryStore & { status?(): MemoryStatus };
  /** 提供后聊天里的 B 站链接会被看完，并开放 /api/videos/summarize。 */
  video?: VideoService;
  /** 日记和待看队列；定时器只在服务进程入口启动。 */
  diary?: DiaryService;
  /** 提供后聊天里的普通网页链接会被读完再聊。 */
  web?: WebService;
}

function healthBody(deps: ServerDeps) {
  const { provider } = deps;
  return {
    ok: true,
    service: "whalepartner-api",
    provider: provider.id,
    model: provider.model,
    fallbacks: provider.providers.slice(1).map((item) => item.id),
    memory: deps.memory?.status?.() ?? { enabled: Boolean(deps.memory), state: deps.memory ? "ready" : "idle" },
  };
}

async function probe({ provider }: ServerDeps) {
  const primary = provider.providers[0];
  if (!primary.listModels) return { checked: false as const };
  try {
    const models = await primary.listModels();
    return { checked: true as const, modelAvailable: models.includes(primary.model) };
  } catch (error) {
    return { checked: true as const, modelAvailable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleChat(deps: ServerDeps, request: IncomingMessage, response: ServerResponse) {
  let text: string;
  let character: CharacterId = DEFAULT_CHARACTER;
  try {
    const body = await readJsonBody(request);
    text = validateUserMessage(body.message);
    if (body.character !== undefined) {
      if (!isCharacterId(body.character)) throw new ChatInputError("未知的角色。");
      character = body.character;
    }
  } catch (error) {
    const status = error instanceof ChatInputError || error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : (error as Error).message });
    return;
  }

  // 客户端断开就中止上游请求，避免白白消耗额度。
  const abort = new AbortController();
  response.on("close", () => {
    if (!response.writableFinished) abort.abort();
  });

  startSse(response);
  try {
    for await (const event of runChat({ provider: deps.provider, store: deps.store, memory: deps.memory, character, video: deps.video, web: deps.web }, text, abort.signal)) {
      const { type, ...data } = event;
      sendSse(response, type, data);
    }
  } catch (error) {
    if (!abort.signal.aborted) sendSse(response, "error", { message: error instanceof Error ? error.message : "聊天失败。" });
  } finally {
    response.end();
  }
}

function text(value: unknown, max: number, field: string, required = true) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ChatInputError(`${field} 不能为空。`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > max) throw new ChatInputError(`${field} 必须是不超过 ${max} 字的文字。`);
  return value.trim();
}

/** 给“添加链接”入口用：看完一个视频，返回摘要，并把它记成她的一段经历。 */
async function handleVideoSummary(deps: ServerDeps, request: IncomingMessage, response: ServerResponse) {
  if (!deps.video) return sendJson(response, 503, { error: "视频功能未启用。" });
  try {
    const url = text((await readJsonBody(request)).url, 500, "url")!;
    const result = await summarizeVideo(deps.video, url);
    let remembered = false;
    if (deps.memory) {
      try {
        await deps.memory.addExperience({ kind: "video", title: result.title, text: sharedParagraph(result.summary), url: result.url, sourceId: result.bvid });
        remembered = true;
      } catch (error) {
        console.warn("视频经历写入记忆失败：", error instanceof Error ? error.message : error);
      }
    }
    return sendJson(response, 200, { video: result, remembered });
  } catch (error) {
    const status = error instanceof ChatInputError || error instanceof SyntaxError ? 400 : error instanceof VideoError ? 502 : 500;
    return sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "视频处理失败。" });
  }
}

async function handleMemories(deps: ServerDeps, request: IncomingMessage, response: ServerResponse, url: URL) {
  const memory = deps.memory;
  if (!memory) return sendJson(response, 503, { error: "记忆功能未启用。" });
  try {
    if (request.method === "GET" && url.pathname === "/api/memories") {
      return sendJson(response, 200, { entries: await memory.list() });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/memories/") && url.pathname !== "/api/memories/experience") {
      await memory.remove(decodeURIComponent(url.pathname.slice("/api/memories/".length)));
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/memories/experience") {
      const body = await readJsonBody(request);
      const link = text(body.url, 500, "url", false);
      if (link && !/^https?:\/\//.test(link)) throw new ChatInputError("url 必须以 http:// 或 https:// 开头。");
      const entry = await memory.addExperience({
        kind: text(body.kind, 32, "kind")!,
        title: text(body.title, 120, "title")!,
        text: text(body.text, 4000, "text")!,
        url: link,
        sourceId: text(body.sourceId, 64, "sourceId", false),
      });
      return sendJson(response, 200, { entry });
    }
    return sendJson(response, 404, { error: "未找到。" });
  } catch (error) {
    const status = error instanceof ChatInputError ? 400 : error instanceof SyntaxError ? 400 : 500;
    return sendJson(response, status, { error: error instanceof SyntaxError ? "请求体不是有效的 JSON。" : error instanceof Error ? error.message : "记忆请求失败。" });
  }
}

async function handleDiary(deps: ServerDeps, request: IncomingMessage, response: ServerResponse, url: URL) {
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

export function createApiServer(deps: ServerDeps): Server {
  return createServer(async (request, response) => {
    applyCors(request, response);
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        const body = healthBody(deps);
        sendJson(response, 200, url.searchParams.get("probe") === "1" ? { ...body, probe: await probe(deps) } : body);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/note") {
        const character = url.searchParams.get("character") ?? DEFAULT_CHARACTER;
        if (!isCharacterId(character)) return sendJson(response, 400, { error: "未知的角色。" });
        const note = deps.store.getNote(character);
        return sendJson(response, 200, { note: note ? { text: note.text, updatedAt: note.updatedAt } : null });
      }
      if (request.method === "GET" && url.pathname === "/api/chat/history") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
        const character = url.searchParams.get("character") ?? DEFAULT_CHARACTER;
        if (!isCharacterId(character)) return sendJson(response, 400, { error: "未知的角色。" });
        sendJson(response, 200, { messages: deps.store.recent(limit, character) });
        return;
      }
      if (request.method === "DELETE" && url.pathname === "/api/chat/history") {
        deps.store.clear();
        sendJson(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/diary" || url.pathname.startsWith("/api/diary/")) {
        await handleDiary(deps, request, response, url);
        return;
      }
      if (url.pathname.startsWith("/api/memories")) {
        await handleMemories(deps, request, response, url);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/videos/summarize") {
        await handleVideoSummary(deps, request, response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/chat") {
        await handleChat(deps, request, response);
        return;
      }
      sendJson(response, 404, { error: "未找到。" });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "服务内部错误。" });
    }
  });
}

if (import.meta.main) {
  const config = loadConfig();
  const lan = process.argv.includes("--lan");
  const host = lan ? "0.0.0.0" : config.host;
  const provider = createChatProvider(config);
  const store = new ChatStore(config.dbPath);
  const diaryStore = new DiaryStore(config.dbPath);
  const memory = config.memoryEnabled
    ? new LazyMemoryStore({ dataDir: config.memoryDir, provider })
    : undefined;
  const video = createVideoService();
  const diary = new DiaryService({ store: diaryStore, provider, memory, video });
  const server = createApiServer({ config, provider, store, memory, video, diary, web: createWebService() });
  let stopDiaryScheduler = () => {};
  server.on("close", () => {
    stopDiaryScheduler();
    void diary.waitForIdle().finally(() => {
      diaryStore.close();
      store.close();
    });
  });
  server.listen(config.port, host, () => {
    stopDiaryScheduler = startDiaryScheduler(config.diaryCron, diary);
    console.log(`WhalePartner API：http://${host}:${config.port}`);
    console.log(`日记计划：${config.diaryCron}（本机时区；API 运行时生效）`);
    console.log(`模型链：${provider.providers.map((item) => `${item.id}(${item.model})`).join(" → ")}`);
    if (lan) console.log("已开放局域网访问。没有登录保护，只在可信网络里使用。");
  });
}
