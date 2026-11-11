import { readFileSync } from "node:fs";

const template = readFileSync(new URL("./prompts/video-summary.md", import.meta.url), "utf8").trim();

export function buildVideoSummaryPrompt(
  formattedText: string,
  frameImages: Array<{ time: number; reason: string }> = [],
) {
  const frameIndex = frameImages.length === 0
    ? "没有附加关键帧图像。"
    : frameImages.map((frame, index) => `附图 ${index + 1}：${frame.time} 秒；${frame.reason}`).join("\n");

  return `${template}\n\n--- 视频证据文本 ---\n${formattedText}\n--- 视频证据文本结束 ---\n\n--- Codex 附图索引 ---\n${frameIndex}\n--- 附图索引结束 ---`;
}
