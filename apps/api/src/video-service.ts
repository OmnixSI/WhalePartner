import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertBilibiliRequestAllowed, collectBilibiliVideoEvidence, normalizeBilibiliInput } from "./bilibili.ts";
import { isBilibiliSessionValid, loadBilibiliSession } from "./bilibili-session.ts";
import { summarizeWithCodex } from "./codex.ts";
import { buildVideoSummaryPrompt } from "./prompt.ts";

export interface CollectedVideo {
  bvid: string;
  title: string;
  uploader: string;
  url: string;
  durationSeconds: number | null;
  /** 评论、弹幕只算辅助资料；字幕和关键帧至少要有一样才会调用模型。 */
  hasTranscript: boolean;
  frameCount: number;
  /** 释放抽出来的临时关键帧。 */
  dispose(): Promise<void>;
  /** @internal 交给摘要步骤用 */
  prompt: string;
  framePaths: string[];
}

export interface VideoSummary {
  bvid: string;
  title: string;
  uploader: string;
  url: string;
  durationSeconds: number | null;
  /** 模型生成的整条视频摘要（markdown：“分享给你” + “来源与依据”）。 */
  summary: string;
  hasTranscript: boolean;
  frameCount: number;
}

/** 视频流程拆成“采集资料”和“摘要”两步，聊天可以在两步之间告诉用户进度。 */
export interface VideoService {
  collect(input: string): Promise<CollectedVideo>;
  summarize(collected: CollectedVideo): Promise<VideoSummary>;
}

export class VideoError extends Error {}
export class VideoBusyError extends VideoError {}

const SECRET = /SESSDATA=[^\s&;]+/gi;
const scrub = (message: string) =>
  message.replace(SECRET, "SESSDATA=[隐藏]").replace(/https?:\/\/[^\s]+/g, (url) => url.split("?")[0] + "?[参数隐藏]");

let busy = false;

/** 同一时间只处理一个视频：B 站有限流，Codex 也不适合并发。返回释放函数。 */
export function acquireVideoLock(): () => void {
  if (busy) throw new VideoBusyError("正在处理另一个视频，请稍后再试。");
  busy = true;
  return () => {
    busy = false;
  };
}

/** 在聊天文字里找 Bilibili 链接、b23.tv 短链或 BV 号。 */
export function extractVideoTarget(text: string): string | undefined {
  const link = /https?:\/\/(?:[\w-]+\.)?(?:bilibili\.com|b23\.tv)\/[^\s<>"'，。！？）)]+/i.exec(text)?.[0];
  if (link) return link;
  return /(?<![0-9A-Za-z])BV[0-9A-Za-z]{10}(?![0-9A-Za-z])/.exec(text)?.[0];
}

/** “分享给你”那一段；格式不符时退回整段摘要的前部分。 */
export function sharedParagraph(summary: string): string {
  const match = /#\s*分享给你\s*\n+([\s\S]*?)(?:\n#\s*来源与依据|$)/.exec(summary);
  const text = (match?.[1] ?? summary).trim();
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
}

export function createVideoService(): VideoService {
  return {
    async collect(input) {
      const target = normalizeBilibiliInput(input);
      const tempDir = await mkdtemp(join(tmpdir(), "whalepartner-video-"));
      const dispose = () => rm(tempDir, { recursive: true, force: true });
      try {
        await assertBilibiliRequestAllowed();
        const session = await loadBilibiliSession();
        if (session && !(await isBilibiliSessionValid(session.sessdata))) {
          throw new VideoError("本机保存的 B 站登录态已失效，请重新登录后再试。");
        }
        const source = await collectBilibiliVideoEvidence(target, session?.sessdata ?? "", { framesDir: tempDir });
        if (source.rateLimit.limited) throw new VideoError("B 站触发了限流保护，稍后再试。");
        const hasTranscript = Boolean(source.transcript.text?.trim());
        if (!hasTranscript && source.frameImages.length === 0) throw new VideoError("没有取得字幕或关键帧，无法看这个视频。");
        return {
          bvid: source.bvid,
          title: source.metadata.title ?? "",
          uploader: source.metadata.uploader?.name ?? "",
          url: source.canonicalUrl,
          durationSeconds: source.metadata.duration ?? null,
          hasTranscript,
          frameCount: source.frameImages.length,
          prompt: buildVideoSummaryPrompt(source.formattedText, source.frameImages),
          framePaths: source.frameImages.map((frame) => frame.path),
          dispose,
        };
      } catch (error) {
        await dispose();
        throw error instanceof VideoError ? error : new VideoError(scrub(error instanceof Error ? error.message : String(error)));
      }
    },

    async summarize(collected) {
      try {
        const result = await summarizeWithCodex(collected.prompt, collected.framePaths);
        return {
          bvid: collected.bvid,
          title: collected.title,
          uploader: collected.uploader,
          url: collected.url,
          durationSeconds: collected.durationSeconds,
          summary: result.message.trim(),
          hasTranscript: collected.hasTranscript,
          frameCount: collected.frameCount,
        };
      } catch (error) {
        throw new VideoError(scrub(error instanceof Error ? error.message : String(error)));
      } finally {
        await collected.dispose();
      }
    },
  };
}

/** 一步完成采集和摘要（给 HTTP 接口用）。 */
export async function summarizeVideo(service: VideoService, input: string): Promise<VideoSummary> {
  const release = acquireVideoLock();
  try {
    return await service.summarize(await service.collect(input));
  } finally {
    release();
  }
}
