import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractAll, parseBvid } from "../vendor/dsh-bilibili/lib/extractor.js";
import { formatExtraction } from "../vendor/dsh-bilibili/lib/format.js";

const COMMENT_LIMIT = 20;
const RATE_LIMIT_PATH = resolve(import.meta.dirname, "../../../.local/bilibili-rate-limit.json");

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

export async function collectBilibiliText(input: string, sessdata = "") {
  await assertBilibiliRequestAllowed();
  const url = normalizeBilibiliInput(input);
  const extraction = await extractAll({
    url,
    commentLimit: COMMENT_LIMIT,
    extractFrames: false,
    downloadVideo: false,
    asrProvider: "none",
    visionProvider: "none",
    sessdata,
  });

  const rateLimit = extraction.rateLimit ?? { limited: false, status: null, retryAt: null };
  await recordBilibiliCooldown(rateLimit);

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
    rateLimit,
    formattedText,
    media: {
      videoDownloaded: false,
      audioDownloaded: false,
      framesExtracted: false,
      asrProvider: "none",
    },
  };
}
