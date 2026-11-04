import { createServer, type Server } from "node:http";
import { loadConfig, type ApiConfig } from "./config.ts";
import { applyCors, sendJson } from "./http.ts";
import { createChatProvider } from "./llm/index.ts";
import type { FallbackChatProvider } from "./llm/router.ts";

export interface ServerDeps {
  config: ApiConfig;
  provider: FallbackChatProvider;
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
  const server = createApiServer({ config, provider });
  server.listen(config.port, host, () => {
    console.log(`WhalePartner API：http://${host}:${config.port}`);
    console.log(`模型链：${provider.providers.map((item) => `${item.id}(${item.model})`).join(" → ")}`);
    if (lan) console.log("已开放局域网访问。没有登录保护，只在可信网络里使用。");
  });
}
