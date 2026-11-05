import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EmotionFilter } from "./emotion.ts";
import type { ChatProvider } from "./llm/types.ts";

// MIT：MrGeDiao/shuorenhua 的官方压缩版规则，原样放在 vendor/shuorenhua/。
const RULES = readFileSync(resolve(import.meta.dirname, "../vendor/shuorenhua/shuorenhua-mini.md"), "utf8").trim();

const REQUEST = [
  "请按上面的规则改写下面这段文字，使用 in-place 力度：只在句内改，不删句、不并句、不重排。",
  "这是一个角色写的第一人称日记，要保留她的口气、语气词和感受，改成像真人随手写下的话，去掉套话和 AI 腔。",
  "只输出改好的全文，不加解释。",
].join("");

/** 改写后长度偏离太多说明模型在重写或丢信息，这时宁可保留原文。 */
function plausible(original: string, rewritten: string) {
  const ratio = rewritten.length / Math.max(1, original.length);
  return rewritten.length > 0 && ratio >= 0.6 && ratio <= 1.3;
}

export async function humanizeText(provider: ChatProvider, text: string, signal?: AbortSignal): Promise<string> {
  const filter = new EmotionFilter();
  let out = "";
  try {
    for await (const delta of provider.stream(
      [
        { role: "system", content: RULES },
        { role: "user", content: `${REQUEST}\n\n<text>\n${text}\n</text>` },
      ],
      { temperature: 0.3, signal },
    )) {
      if (delta.text) out += filter.feed(delta.text).text;
    }
    out += filter.flush();
  } catch (error) {
    if (signal?.aborted) throw error;
    return text; // 改写只是锦上添花，失败就用原文
  }
  const rewritten = out.trim();
  return plausible(text, rewritten) ? rewritten : text;
}
