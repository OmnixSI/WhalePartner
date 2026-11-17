import { readFileSync } from "node:fs";
import { outputLanguageNote } from "../i18n/index.ts";

const template = readFileSync(new URL("./prompts/video-summary.md", import.meta.url), "utf8").trim();

/** 英文界面：两个小标题也换成英文（sharedParagraph 中英两种都认）。 */
const VIDEO_EN = 'Use "# Sharing with you" and "# Sources & basis" as the two headings instead of the Chinese ones.';

// i18n-ignore-start：给模型的提示词
export function buildVideoSummaryPrompt(
  formattedText: string,
  frameImages: Array<{ time: number; reason: string }> = [],
) {
  const frameIndex = frameImages.length === 0
    ? "没有附加关键帧图像。"
    : frameImages.map((frame, index) => `附图 ${index + 1}：${frame.time} 秒；${frame.reason}`).join("\n");

  return `${template}\n\n--- 视频证据文本 ---\n${formattedText}\n--- 视频证据文本结束 ---\n\n--- Codex 附图索引 ---\n${frameIndex}\n--- 附图索引结束 ---${outputLanguageNote(VIDEO_EN)}`;
}
// i18n-ignore-end
