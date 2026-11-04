import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { loadConfig, type ApiConfig } from "./config.ts";
import { ChatInputError, runChat, validateUserMessage } from "./chat.ts";
import { applyCors, readJsonBody, sendJson, sendSse, startSse } from "./http.ts";
import { createChatProvider } from "./llm/index.ts";
import type { FallbackChatProvider } from "./llm/router.ts";
import { ChatStore } from "./store.ts";

export interface ServerDeps {
  config: ApiConfig;
  provider: FallbackChatProvider;
  store: ChatStore;
}

function healthBody({ provider }: ServerDeps) {
  return {
    ok: true,
    service: "whalepartner-api",
    provider: provider.id,
    model: provider.model,
    fallbacks: provider.providers.slice(1).map((item) => item.id),
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
  try {
    text = validateUserMessage((await readJsonBody(request)).message);
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
    for await (const event of runChat({ provider: deps.provider, store: deps.store }, text, abort.signal)) {
      const { type, ...data } = event;
      sendSse(response, type, data);
    }
  } catch (error) {
    if (!abort.signal.aborted) sendSse(response, "error", { message: error instanceof Error ? error.message : "聊天失败。" });
  } finally {
    response.end();
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
      if (request.method === "GET" && url.pathname === "/api/chat/history") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
        sendJson(response, 200, { messages: deps.store.recent(limit) });
        return;
      }
      if (request.method === "DELETE" && url.pathname === "/api/chat/history") {
        deps.store.clear();
        sendJson(response, 200, { ok: true });
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
  const server = createApiServer({ config, provider, store });
  server.listen(config.port, host, () => {
    console.log(`WhalePartner API：http://${host}:${config.port}`);
    console.log(`模型链：${provider.providers.map((item) => `${item.id}(${item.model})`).join(" → ")}`);
    if (lan) console.log("已开放局域网访问。没有登录保护，只在可信网络里使用。");
  });
}
