import type { OpenAiCompatibleConfig } from "../server/config.ts";
import { OpenAiCompatibleProvider } from "./openai-compatible.ts";

/** DeepSeek 官方 API 是 OpenAI 兼容接口；密钥只从服务端配置读取。 */
export function createDeepSeekProvider(config: OpenAiCompatibleConfig, timeoutMs?: number) {
  return new OpenAiCompatibleProvider({ id: "deepseek", ...config, timeoutMs });
}
