import { extractAll, parseBvid } from "../vendor/dsh-bilibili/lib/extractor.js";
import { formatExtraction } from "../vendor/dsh-bilibili/lib/format.js";

const COMMENT_LIMIT = 20;

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

export async function collectBilibiliText(input: string) {
  const url = normalizeBilibiliInput(input);
  const extraction = await extractAll({
    url,
    commentLimit: COMMENT_LIMIT,
    extractFrames: false,
    downloadVideo: false,
    asrProvider: "none",
    visionProvider: "none",
    sessdata: "",
  });

  if (extraction.success !== true) {
    throw new Error(extraction.error ?? "Bilibili 资料提取失败。");
  }

  const comments = extraction.comments as VideoComments | undefined;
  const commentData = comments ?? { total: 0, fetched: 0, comments: [], note: "" };
  const modelComments = {
    ...commentData,
    comments: commentData.comments.slice(0, COMMENT_LIMIT).map((comment) => ({
      user: "观众",
      content: comment.content,
      likes: comment.likes,
      replies: (comment.replies ?? []).slice(0, 2).map((reply) => ({
        user: "观众",
        content: reply.content,
        likes: reply.likes,
      })),
    })),
  };

  const formattedText = formatExtraction({ ...extraction, comments: modelComments });
  const bvid = extraction.bvid;

  return {
    bvid,
    canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
    fetchedAt: new Date().toISOString(),
    metadata: extraction.metadata,
    transcript: extraction.transcript,
    comments: modelComments,
    danmaku: extraction.danmaku,
    formattedText,
    media: {
      videoDownloaded: false,
      audioDownloaded: false,
      framesExtracted: false,
      asrProvider: "none",
    },
  };
}
