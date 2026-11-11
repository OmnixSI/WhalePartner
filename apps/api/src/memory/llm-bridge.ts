import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readJsonBody, RequestBodyError, sendJson } from "../server/http.ts";
import type { ChatMessage, ChatProvider } from "../llm/types.ts";

export interface LlmBridge {
  baseUrl: string;
  apiKey: string;
  close(): void;
}

const JSON_HINT = "只输出一个合法的 JSON 对象，不要任何解释，不要用代码块包裹。";

function toMessages(raw: unknown, wantJson: boolean): ChatMessage[] {
  const list = Array.isArray(raw) ? raw : [];
  const messages: ChatMessage[] = list.flatMap((item) => {
    const m = item as { role?: unknown; content?: unknown };
    const role = m.role === "system" || m.role === "assistant" ? m.role : "user";
    return typeof m.content === "string" ? [{ role, content: m.content } as ChatMessage] : [];
  });
  if (wantJson) messages.push({ role: "system", content: JSON_HINT });
  return messages;
}

/**
 * 给 mem0 用的本机 OpenAI 兼容端点：把它的聊天补全请求转给我们自己的模型链
 * （DeepSeek → 备用 → Codex），这样记忆提炼不依赖某一家，也不单独持有密钥。
 * 只监听 127.0.0.1 的随机端口，并要求启动时生成的随机令牌。
 */
export async function startLlmBridge(provider: ChatProvider): Promise<LlmBridge> {
  const token = randomBytes(24).toString("hex");
  const server: Server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${token}`) return sendJson(response, 401, { error: { message: "unauthorized" } });
      if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) return sendJson(response, 404, { error: { message: "not found" } });

      const body = await readJsonBody(request);
      const wantJson = (body.response_format as { type?: unknown } | undefined)?.type === "json_object";
      let content = "";
      let usage = { inputTokens: 0, outputTokens: 0 };
      for await (const delta of provider.stream(toMessages(body.messages, wantJson), { temperature: 0 })) {
        if (delta.text) content += delta.text;
        if (delta.usage) usage = { inputTokens: delta.usage.inputTokens, outputTokens: delta.usage.outputTokens };
      }
      sendJson(response, 200, {
        id: "bridge",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: String(body.model ?? "bridge"),
        choices: [{ index: 0, message: { role: "assistant", content: content.trim() }, finish_reason: "stop" }],
        usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens, total_tokens: usage.inputTokens + usage.outputTokens },
      });
    } catch (error) {
      sendJson(response, error instanceof RequestBodyError ? error.status : 502, { error: { message: error instanceof Error ? error.message : "bridge error" } });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: token, close: () => server.close() };
}
