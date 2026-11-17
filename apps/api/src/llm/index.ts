import { msg } from "../i18n/index.ts";
import type { ApiConfig } from "../server/config.ts";
import { CodexChatProvider } from "./codex-chat.ts";
import { createDeepSeekProvider } from "./deepseek.ts";
import { OpenAiCompatibleProvider } from "./openai-compatible.ts";
import { FallbackChatProvider } from "./router.ts";

/** 主模型 DeepSeek → 备用 OpenAI 兼容接口 → 本机 Codex。没有任何可用提供方时抛错。 */
export function createChatProvider(config: ApiConfig) {
  const providers = [];
  if (config.deepseek) providers.push(createDeepSeekProvider(config.deepseek, config.llmTimeoutMs));
  if (config.backup) {
    providers.push(new OpenAiCompatibleProvider({ id: "backup", ...config.backup, timeoutMs: config.llmTimeoutMs }));
  }
  if (config.codexFallback) providers.push(new CodexChatProvider());
  if (providers.length === 0) {
    throw new Error(msg().core.llm.noModel);
  }
  return new FallbackChatProvider(providers);
}
