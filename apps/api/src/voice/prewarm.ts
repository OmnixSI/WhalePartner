import type { AsrService } from "./asr.ts";
import type { TtsService } from "./tts.ts";

/**
 * 启动预热：先 X-ASR，结束（成功或失败）后再 CosyVoice（#149）。
 * 两边同时载入会抢 CPU 和内存带宽，打开 App 后语音识别就绪要多等约 1 秒；
 * 语音合成要等第一条回复才用到，晚一两秒就绪不影响使用。
 */
export function prewarmVoice(asr: AsrService, tts: TtsService, warn: (message: string) => void = console.warn): Promise<void> {
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
  return asr.prewarmIfInstalled()
    .catch((error: unknown) => warn(`X-ASR 启动预热失败：${reason(error)}`))
    .then(() => tts.prewarmIfInstalled())
    .catch((error: unknown) => warn(`本地语音启动预热失败：${reason(error)}`));
}
