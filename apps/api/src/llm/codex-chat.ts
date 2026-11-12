import { streamWithCodexAppServer, listCodexModels, resolveCodexModel, resolveCodexSettings } from "../codex/app-server.ts";
import { readStoredCodexSettings } from "../codex/settings.ts";
import type { ChatMessage, ChatProvider, LlmDelta, StreamOptions } from "./types.ts";

const ROLE_LABEL = { system: "设定", user: "用户", assistant: "你" } as const;

/** 把对话整理成一段文字提示，交给本机 Codex 续写下一条回复。 */
export function buildCodexChatPrompt(messages: ChatMessage[]) {
  const lines = messages.map((message) => `【${ROLE_LABEL[message.role]}】\n${message.content}`);
  return [
    "下面是一段对话记录。请以“你”的身份，严格遵守【设定】，只输出你的下一条回复正文，不要加角色前缀或解释。",
    "",
    ...lines,
    "",
    "【你】",
  ].join("\n");
}

/** 本地开发兜底：通过本机 Codex app-server 返回正文增量。正式多端服务不依赖它。 */
export class CodexChatProvider implements ChatProvider {
  readonly id = "codex";
  /** 最近一次按模型列表解析出的模型；没保存设置时，同步的 `model` 只能靠它报出真实默认项。 */
  #resolved = "";

  get model() {
    return readStoredCodexSettings().model || this.#resolved || "Codex 默认模型";
  }

  async resolveModel(signal?: AbortSignal) {
    const stored = readStoredCodexSettings();
    if (stored.model) return stored.model;
    const option = resolveCodexModel(stored, await listCodexModels(signal));
    if (!option) throw new Error("本机 Codex 没有可用模型。");
    this.#resolved = option.model;
    return option.model;
  }

  async listModels(signal?: AbortSignal) {
    signal?.throwIfAborted();
    return (await listCodexModels(signal)).map((model) => model.model);
  }

  async *stream(messages: ChatMessage[], options: StreamOptions = {}): AsyncGenerator<LlmDelta> {
    options.signal?.throwIfAborted();
    const started = performance.now();
    const models = await listCodexModels(options.signal);
    const settings = resolveCodexSettings(readStoredCodexSettings(), models);
    this.#resolved = settings.model;
    console.info(`[codex-perf] ${JSON.stringify({ stage: "models", ms: Math.round(performance.now() - started), model: settings.model, effort: settings.effort })}`);
    for await (const text of streamWithCodexAppServer(buildCodexChatPrompt(messages), settings, options.signal)) {
      yield { text };
    }
  }
}
