import type { ChatMessage, ChatProvider, LlmDelta, LlmUsage, StreamOptions } from "./types.ts";

export interface OpenAiCompatibleOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ProviderError extends Error {
  readonly status?: number;
  readonly provider: string;

  constructor(provider: string, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}

/** 解析 SSE 响应体，逐条产出 data 载荷。注释行（以冒号开头的心跳）会被忽略。 */
export async function* readSseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  const parseBlock = (block: string) =>
    block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match) break;
      const data = parseBlock(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
      if (data) yield data;
    }
  }

  buffer += decoder.decode();
  const tail = parseBlock(buffer);
  if (tail) yield tail;
}

function toUsage(raw: unknown): LlmUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_cache_hit_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
  if (typeof usage.prompt_tokens !== "number" || typeof usage.completion_tokens !== "number") return undefined;
  const cached =
    typeof usage.prompt_cache_hit_tokens === "number"
      ? usage.prompt_cache_hit_tokens
      : typeof usage.prompt_tokens_details?.cached_tokens === "number"
        ? usage.prompt_tokens_details.cached_tokens
        : 0;
  return { inputTokens: usage.prompt_tokens, cachedInputTokens: cached, outputTokens: usage.completion_tokens };
}

/** OpenAI 兼容的流式聊天提供方，DeepSeek 与备用模型共用。 */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly id: string;
  readonly model: string;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAiCompatibleOptions) {
    this.id = options.id;
    this.model = options.model;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? 30000;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /** 错误信息里去掉密钥，避免进入日志或响应。 */
  #scrub(message: string) {
    return this.#apiKey ? message.split(this.#apiKey).join("[密钥已隐藏]") : message;
  }

  #headers() {
    return { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await this.#fetch(`${this.#baseUrl}/models`, {
      headers: this.#headers(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]) : AbortSignal.timeout(this.#timeoutMs),
    }).catch((error: unknown) => {
      throw new ProviderError(this.id, this.#scrub(`无法连接 ${this.id}：${String(error instanceof Error ? error.message : error)}`));
    });
    if (!response.ok) throw new ProviderError(this.id, `${this.id} 模型列表请求失败（HTTP ${response.status}）。`, response.status);
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? []).flatMap((item) => (typeof item.id === "string" ? [item.id] : []));
  }

  async *stream(messages: ChatMessage[], options: StreamOptions = {}): AsyncGenerator<LlmDelta> {
    // 超时只约束“等到首个响应”；开始流式输出后由调用方的 signal 控制。
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.#timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.#headers(),
        signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        }),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const reason = timeout.signal.aborted ? "等待响应超时" : String(error instanceof Error ? error.message : error);
      throw new ProviderError(this.id, this.#scrub(`无法连接 ${this.id}：${reason}`));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let detail = "";
      try {
        const body = (await response.json()) as { error?: { message?: unknown } };
        if (typeof body.error?.message === "string") detail = `：${body.error.message}`;
      } catch {
        /* 上游没有返回 JSON 错误体 */
      }
      throw new ProviderError(this.id, this.#scrub(`${this.id} 请求失败（HTTP ${response.status}）${detail}`), response.status);
    }
    if (!response.body) throw new ProviderError(this.id, `${this.id} 没有返回响应体。`);

    for await (const data of readSseData(response.body as unknown as AsyncIterable<Uint8Array>)) {
      if (data === "[DONE]") return;
      let event: { choices?: Array<{ delta?: { content?: unknown } }>; usage?: unknown };
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      const content = event.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) yield { text: content };
      const usage = toUsage(event.usage);
      if (usage) yield { usage };
    }
  }
}
