import { readFileSync } from "node:fs";

const template = readFileSync(new URL("./prompts/video-summary.md", import.meta.url), "utf8").trim();

export function buildVideoSummaryPrompt(formattedText: string) {
  return `${template}\n\n--- 以下是待分析的 Bilibili 文本证据 ---\n${formattedText}\n--- 文本证据结束 ---`;
}
