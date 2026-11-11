import { loadConfig } from "./server/config.ts";
import { createChatProvider } from "./llm/index.ts";

/** 发一次真实文本请求，确认模型链可用，并打印所用提供方和 token 用量。 */
const provider = createChatProvider(loadConfig());
const startedAt = performance.now();
let text = "";
let used = "";
let usage;
for await (const delta of provider.stream([
  { role: "system", content: "你是一个简短回答的助手。" },
  { role: "user", content: "用一句话介绍你自己。" },
])) {
  if (delta.text) text += delta.text;
  if (delta.provider) used = delta.provider;
  if (delta.usage) usage = delta.usage;
}
console.log(JSON.stringify({ provider: used, ms: Math.round(performance.now() - startedAt), text, usage }, null, 2));
