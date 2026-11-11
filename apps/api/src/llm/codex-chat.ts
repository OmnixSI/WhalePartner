import { streamWithCodexAppServer, listCodexModels, resolveCodexSettings } from "../codex/app-server.ts";
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

  get model() {
    return readStoredCodexSettings().model || "gpt-6-luna";
  }

  async listModels(signal?: AbortSignal) {
    signal?.throwIfAborted();
    return (await listCodexModels(signal)).map((model) => model.model);
  }

  async *stream(messages: ChatMessage[], options: StreamOptions = {}): AsyncGenerator<LlmDelta> {
    options.signal?.throwIfAborted();
    const models = await listCodexModels(options.signal);
    const settings = resolveCodexSettings(readStoredCodexSettings(), models);
    for await (const text of streamWithCodexAppServer(buildCodexChatPrompt(messages), settings, options.signal)) {
      yield { text };
    }
  }
}
