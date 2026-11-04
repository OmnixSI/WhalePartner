import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { capTranscriptSmart } from "../vendor/dsh-bilibili/lib/format.js";
import { extractAll, parseBvid } from "../vendor/dsh-bilibili/lib/extractor.js";

const COMMENT_LIMIT = 20;
const MAX_FRAMES = 8;
const MAX_TRANSCRIPT_CHARS = 12000;
const RATE_LIMIT_PATH = resolve(import.meta.dirname, "../../../.local/bilibili-rate-limit.json");
const SUMMARY_ROOT = resolve(import.meta.dirname, "../../../.local/video-summaries");

type VideoComment = {
  content: string;
  likes: number;
  replies?: Array<{ content: string; likes: number }>;
};

type VideoComments = {
  total: number;
  fetched: number;
  comments: VideoComment[];
  note: string;
};

type TranscriptSegment = { start: number; end: number; text: string };

type VideoTranscript = {
  source?: string;
  language?: string;
  text?: string;
  segments?: TranscriptSegment[];
  total_segments?: number;
  note?: string;
};

type ExtractedFrame = {
  time: number;
  requested_time?: number | null;
  reason: string;
  subtitle_text?: string;
  has_image: boolean;
  path?: string | null;
  error?: string | null;
  description?: string;
  vision_error?: string | null;
};

type VideoFrameEvidence = {
  time: number;
  requestedTime?: number | null;
  reason: string;
  transcriptContext: string;
  path: string;
};

type VideoMetadata = {
  title?: string;
  description?: string;
  uploader?: { name?: string };
  duration?: number;
  pubdate?: number;
  category?: string;
  pages?: number;
};

type ExtractedVideo = {
  success?: boolean;
  error?: string;
  bvid?: string;
  elapsed_seconds?: number;
  metadata?: VideoMetadata;
  transcript?: VideoTranscript;
  comments?: VideoComments;
  danmaku?: {
    total?: number;
    top_messages?: Array<{ text: string; count: number }>;
    samples?: Array<{ time: number; text: string }>;
    note?: string;
  };
  frames?: {
    enabled?: boolean;
    stage?: string;
    strategy?: string;
    mode?: string;
    note?: string;
    error?: string | null;
    frames?: ExtractedFrame[];
  };
  rateLimit?: { limited?: boolean; retryAt?: string | null; status?: number | null };
};

export async function assertBilibiliRequestAllowed() {
  let pause: { retryAt?: string; status?: number };
  try {
    pause = JSON.parse(await readFile(RATE_LIMIT_PATH, "utf8"));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw error;
  }

  const retryAt = Date.parse(pause.retryAt ?? "");
  if (Number.isFinite(retryAt) && retryAt > Date.now()) {
    const status = pause.status ?? "限流";
    const reason = typeof status === "number" && status < 0 ? `风控码 ${status}` : `HTTP ${status}`;
    throw new Error(`B 站触发 ${reason}，本机已暂停视频请求至 ${new Date(retryAt).toLocaleString()}。`);
  }
  await rm(RATE_LIMIT_PATH, { force: true });
}

async function recordBilibiliCooldown(rateLimit: {
  limited?: boolean;
  retryAt?: string | null;
  status?: number | null;
}) {
  if (!rateLimit.limited || !rateLimit.retryAt) return;
  await mkdir(resolve(RATE_LIMIT_PATH, ".."), { recursive: true, mode: 0o700 });
  await writeFile(RATE_LIMIT_PATH, JSON.stringify({ status: rateLimit.status, retryAt: rateLimit.retryAt }, null, 2) + "\n", {
    mode: 0o600,
  });
  await chmod(RATE_LIMIT_PATH, 0o600);
}

export function normalizeBilibiliInput(input: string) {
  const text = input.trim();
  if (/^BV[0-9A-Za-z]{10}$/.test(text)) return text;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("请输入 Bilibili 视频链接、b23.tv 短链或 BV 号。");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("视频链接必须使用 HTTP 或 HTTPS。");
  }

  const host = url.hostname.toLowerCase();
  if (host === "b23.tv") {
    if (url.pathname === "/") throw new Error("b23.tv 链接缺少视频路径。");
    url.protocol = "https:";
    return url.toString();
  }

  if (host === "bilibili.com" || host.endsWith(".bilibili.com")) {
    const bvid = parseBvid(url.toString());
    if (bvid) return bvid;
  }

  throw new Error("目前只支持 Bilibili 视频链接和 b23.tv 短链。");
}

function formatVideoTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "未知";
  const total = Math.floor(seconds);
  const hour = Math.floor(total / 3600);
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  return hour > 0
    ? `${hour}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`
    : `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function cleanText(text: string, maxLength: number) {
  const cleaned = text.trim().replace(/\s+/g, " ");
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) + "…" : cleaned;
}

export function formatBilibiliEvidence(input: {
  bvid: string;
  canonicalUrl: string;
  metadata: VideoMetadata;
  transcript: VideoTranscript;
  comments: VideoComments;
  danmaku: NonNullable<ExtractedVideo["danmaku"]>;
  frameImages: VideoFrameEvidence[];
}) {
  const lines = [
    "--- 视频来源 ---",
    `标题：${input.metadata.title ?? "未知"}`,
    `作者：${input.metadata.uploader?.name ?? "未知"}`,
    `时长：${formatVideoTime(input.metadata.duration ?? Number.NaN)}`,
    `BV 号：${input.bvid}`,
    `链接：${input.canonicalUrl}`,
  ];

  const description = cleanText(input.metadata.description ?? "", 800);
  if (description) lines.push(`简介（背景信息）：${description}`);

  lines.push("", "--- 视频语音转写（主要内容证据） ---");
  if (input.transcript.text) {
    lines.push(`来源：${input.transcript.source ?? "未知"}；语言：${input.transcript.language ?? "未知"}`);
    const segments = input.transcript.segments ?? [];
    const timestamped = segments.length > 0
      ? segments.map((segment) => `[${formatVideoTime(segment.start)}] ${segment.text}`).join("\n")
      : input.transcript.text;
    lines.push(capTranscriptSmart(segments, timestamped, MAX_TRANSCRIPT_CHARS, 180));
    if (input.transcript.note) lines.push(`转写说明：${input.transcript.note}`);
  } else {
    lines.push(`未获取到字幕或转写正文：${input.transcript.note ?? "原因未知"}`);
  }

  lines.push("", "--- 关键帧附件索引 ---");
  if (input.frameImages.length === 0) {
    lines.push("没有可供模型分析的关键帧图像。只能依据上面的文字证据总结，不得描述画面。");
  } else {
    lines.push(`共附加 ${input.frameImages.length} 张图像，顺序与 Codex 输入附件一致：`);
    for (const [index, frame] of input.frameImages.entries()) {
      const context = cleanText(frame.transcriptContext, 160);
      lines.push(
        `附图 ${index + 1}：${formatVideoTime(frame.time)}；选帧原因：${frame.reason}` +
        (context ? `；附近字幕：${context}` : ""),
      );
    }
  }

  const comments = input.comments.comments.slice(0, 8);
  const danmaku = input.danmaku.samples ?? [];
  if (comments.length > 0 || danmaku.length > 0) {
    lines.push("", "--- 观众评论和弹幕（仅作观众反应背景，不代表视频事实） ---");
    for (const comment of comments) {
      lines.push(`评论（${comment.likes} 赞）：${cleanText(comment.content, 300)}`);
      for (const reply of (comment.replies ?? []).slice(0, 1)) {
        lines.push(`  回复：${cleanText(reply.content, 220)}`);
      }
    }
    for (const sample of danmaku.slice(0, 12)) {
      lines.push(`弹幕 ${formatVideoTime(sample.time)}：${cleanText(sample.text, 120)}`);
    }
  }

  return lines.join("\n");
}

export async function collectBilibiliVideoEvidence(input: string, sessdata = "") {
  await assertBilibiliRequestAllowed();
  const url = normalizeBilibiliInput(input);
  const raw = await extractAll({
    url,
    commentLimit: COMMENT_LIMIT,
    extractFrames: true,
    downloadVideo: false,
    maxFrames: MAX_FRAMES,
    framesDir: SUMMARY_ROOT,
    detectScenes: false,
    asrProvider: "bcut",
    visionProvider: "none",
    sessdata,
  }) as ExtractedVideo;

  const rateLimit = raw.rateLimit ?? { limited: false, status: null, retryAt: null };
  await recordBilibiliCooldown(rateLimit);

  if (raw.success !== true) {
    throw new Error(raw.error ?? "Bilibili 视频资料提取失败。");
  }
  if (!raw.bvid) throw new Error("Bilibili 提取结果缺少 BV 号。");

  const metadata = raw.metadata ?? {};
  const transcript = raw.transcript ?? { text: "", source: "none", segments: [], note: "未取得转写信息。" };
  const comments = raw.comments ?? { total: 0, fetched: 0, comments: [], note: "" };
  const danmaku = raw.danmaku ?? { total: 0, top_messages: [], samples: [], note: "" };
  const frames = raw.frames ?? { enabled: false, strategy: "", mode: "none", frames: [] };
  const frameImages = (frames.frames ?? [])
    .filter((frame): frame is ExtractedFrame & { path: string } => frame.has_image && Boolean(frame.path))
    .map((frame) => ({
      time: frame.time,
      requestedTime: frame.requested_time,
      reason: frame.reason,
      transcriptContext: frame.subtitle_text ?? "",
      path: frame.path,
    }));
  const modelComments: VideoComments = {
    ...comments,
    comments: comments.comments.slice(0, COMMENT_LIMIT).map((comment) => ({
      content: comment.content,
      likes: comment.likes,
      replies: (comment.replies ?? []).slice(0, 2).map((reply) => ({
        content: reply.content,
        likes: reply.likes,
      })),
    })),
  };
  const canonicalUrl = `https://www.bilibili.com/video/${raw.bvid}`;

  return {
    bvid: raw.bvid,
    canonicalUrl,
    fetchedAt: new Date().toISOString(),
    metadata,
    transcript,
    comments: modelComments,
    danmaku,
    frames: {
      enabled: frames.enabled,
      stage: frames.stage,
      strategy: frames.strategy,
      mode: frames.mode,
      note: frames.note,
      error: frames.error,
      results: (frames.frames ?? []).map((frame) => ({
        time: frame.time,
        requestedTime: frame.requested_time ?? null,
        hasImage: frame.has_image,
        error: frame.error ?? null,
      })),
    },
    frameImages,
    rateLimit,
    elapsedSeconds: raw.elapsed_seconds,
    media: {
      videoDownloadedLocally: false,
      audioDownloadedLocally: false,
      framesExtracted: frameImages.length > 0,
      frameCount: frameImages.length,
      frameTimes: frameImages.map((frame) => frame.time),
      transcriptSource: transcript.source ?? "none",
    },
    formattedText: formatBilibiliEvidence({
      bvid: raw.bvid,
      canonicalUrl,
      metadata,
      transcript,
      comments: modelComments,
      danmaku,
      frameImages,
    }),
  };
}
