import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  assertBilibiliRequestAllowed,
  collectBilibiliVideoEvidence,
  normalizeBilibiliInput,
} from "./bilibili/video.ts";
import { isBilibiliSessionValid, loadBilibiliSession } from "./bilibili/session.ts";
import { getCodexRequestSettings, summarizeWithCodex } from "./codex/exec.ts";
import { buildVideoSummaryPrompt } from "./video/prompt.ts";

const appDir = resolve(import.meta.dirname, "..");
const webFile = resolve(appDir, "web/index.html");
const maxBodyBytes = 16 * 1024;
let summaryRunning = false;

function elapsedMs(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .replace(/SESSDATA=[^\s&;]+/gi, "SESSDATA=[隐藏]")
    .replace(/https?:\/\/[^\s]+/g, (value) => value.split("?")[0] + "?[参数隐藏]");
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("请求内容过大。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function evidenceView(source: Awaited<ReturnType<typeof collectBilibiliVideoEvidence>>, images: Array<Record<string, unknown>>) {
  return {
    metadata: {
      bvid: source.bvid,
      canonicalUrl: source.canonicalUrl,
      title: source.metadata.title ?? "",
      uploader: source.metadata.uploader?.name ?? "",
      durationSeconds: source.metadata.duration ?? null,
    },
    transcript: {
      source: source.transcript.source ?? "none",
      language: source.transcript.language ?? "",
      characters: source.transcript.text?.length ?? 0,
      segments: source.transcript.segments?.length ?? 0,
      note: source.transcript.note ?? "",
    },
    comments: {
      total: source.comments.total,
      fetched: source.comments.fetched,
      sentToModel: Math.min(8, source.comments.comments.length),
    },
    danmaku: {
      total: source.danmaku.total ?? 0,
      sentToModel: Math.min(12, source.danmaku.samples?.length ?? 0),
    },
    images,
    formattedText: source.formattedText,
    rateLimit: source.rateLimit,
    stageTimings: source.stageTimings ?? {},
    extractorElapsedSeconds: source.elapsedSeconds ?? 0,
  };
}

async function summarize(input: string) {
  const startedAt = performance.now();
  const tempDir = await mkdtemp(join(tmpdir(), "whalepartner-video-ui-"));
  let sessionValidationMs = 0;
  let evidenceCollectionMs = 0;
  let promptBuildMs = 0;
  let codexSummaryMs = 0;
  let source: Awaited<ReturnType<typeof collectBilibiliVideoEvidence>> | undefined;
  let prompt = "";

  try {
    const sessionStartedAt = performance.now();
    await assertBilibiliRequestAllowed();
    const session = await loadBilibiliSession();
    if (session && !(await isBilibiliSessionValid(session.sessdata))) {
      throw new Error("本机保存的 B 站登录态已失效，请重新登录后再试。");
    }
    sessionValidationMs = elapsedMs(sessionStartedAt);

    const evidenceStartedAt = performance.now();
    source = await collectBilibiliVideoEvidence(input, session?.sessdata ?? "", { framesDir: tempDir });
    evidenceCollectionMs = elapsedMs(evidenceStartedAt);

    const images = await Promise.all(source.frameImages.map(async (frame) => {
      const image = await readFile(frame.path);
      return {
        time: frame.time,
        reason: frame.reason,
        transcriptContext: frame.transcriptContext,
        sizeBytes: image.byteLength,
        dataUrl: "data:image/jpeg;base64," + image.toString("base64"),
      };
    }));
    const evidence = evidenceView(source, images);
    const totalImageBytes = images.reduce((sum, image) => sum + Number(image.sizeBytes ?? 0), 0);
    const baseResult = {
      evidence,
      inputData: {
        evidenceTextCharacters: evidence.formattedText.length,
        transcriptCharacters: evidence.transcript.characters,
        transcriptSegments: evidence.transcript.segments,
        commentsSentToModel: evidence.comments.sentToModel,
        danmakuSentToModel: evidence.danmaku.sentToModel,
        imageCount: images.length,
        imageBytes: totalImageBytes,
      },
      model: null,
      reasoningEffort: null,
      timings: {
        sessionValidationMs,
        evidenceCollectionMs,
        extractionStages: evidence.stageTimings,
        promptBuildMs,
        codexSummaryMs,
        artifactWriteMs: null,
        totalMs: elapsedMs(startedAt),
      },
      persistence: "结果只在页面内存中展示；临时帧在请求结束后删除。",
    };

    if (source.rateLimit.limited) {
      return {
        ...baseResult,
        status: "rate-limited",
        summary: null,
        promptText: null,
        usage: null,
        error: "B 站触发了限流保护；程序已记录冷却状态，没有调用摘要模型。",
      };
    }

    if (!source.transcript.text?.trim() && source.frameImages.length === 0) {
      return {
        ...baseResult,
        status: "insufficient-evidence",
        summary: null,
        promptText: null,
        usage: null,
        error: "没有取得字幕/转写正文或关键帧，未调用摘要模型。",
      };
    }

    const promptStartedAt = performance.now();
    prompt = buildVideoSummaryPrompt(source.formattedText, source.frameImages);
    promptBuildMs = elapsedMs(promptStartedAt);
    const codexStartedAt = performance.now();
    try {
      const codexResult = await summarizeWithCodex(prompt, source.frameImages.map((frame) => frame.path));
      codexSummaryMs = elapsedMs(codexStartedAt);
      return {
        ...baseResult,
        status: "summarized",
        model: codexResult.model,
        reasoningEffort: codexResult.reasoningEffort,
        summary: codexResult.message.trim(),
        promptText: prompt,
        usage: {
          promptCharacters: prompt.length,
          summaryCharacters: codexResult.message.length,
          exactTokenUsageAvailable: codexResult.usage !== undefined,
          inputTokens: codexResult.usage?.inputTokens ?? null,
          cachedInputTokens: codexResult.usage?.cachedInputTokens ?? null,
          outputTokens: codexResult.usage?.outputTokens ?? null,
          model: codexResult.model,
          reasoningEffort: codexResult.reasoningEffort,
        },
        timings: {
          ...baseResult.timings,
          promptBuildMs,
          codexSummaryMs,
          totalMs: elapsedMs(startedAt),
        },
        error: null,
      };
    } catch (error) {
      codexSummaryMs = elapsedMs(codexStartedAt);
      return {
        ...baseResult,
        status: "codex-failed",
        summary: null,
        promptText: prompt,
        usage: null,
        timings: {
          ...baseResult.timings,
          promptBuildMs,
          codexSummaryMs,
          totalMs: elapsedMs(startedAt),
        },
        error: safeError(error),
      };
    }
  } catch (error) {
    return {
      status: "failed",
      error: safeError(error),
      timings: {
        sessionValidationMs,
        evidenceCollectionMs,
        extractionStages: source?.stageTimings ?? {},
        promptBuildMs,
        codexSummaryMs,
        artifactWriteMs: null,
        totalMs: elapsedMs(startedAt),
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  try {
    if (request.method === "GET" && requestUrl.pathname === "/") {
      const html = await readFile(webFile);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(html);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      const session = await loadBilibiliSession();
      const codexSettings = await getCodexRequestSettings();
      sendJson(response, 200, {
        ready: true,
        sessionConfigured: Boolean(session),
        model: codexSettings.model,
        reasoningEffort: codexSettings.effort,
        active: summaryRunning,
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/summarize") {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch {
        sendJson(response, 400, { status: "failed", error: "请输入 BV 号或有效的 JSON 请求。" });
        return;
      }
      if (typeof body.input !== "string" || !body.input.trim()) {
        sendJson(response, 400, { status: "failed", error: "请先粘贴 B 站链接或 BV 号。" });
        return;
      }
      let input: string;
      try {
        input = normalizeBilibiliInput(body.input);
      } catch (error) {
        sendJson(response, 400, { status: "failed", error: safeError(error) });
        return;
      }
      if (summaryRunning) {
        sendJson(response, 409, { status: "busy", error: "已有一个视频正在处理，请等它完成。" });
        return;
      }
      summaryRunning = true;
      try {
        const result = await summarize(input);
        const statusCode = result.status === "rate-limited" ? 429
          : result.status === "insufficient-evidence" ? 422
            : result.status === "failed" || result.status === "codex-failed" ? 502 : 200;
        sendJson(response, statusCode, result);
      } finally {
        summaryRunning = false;
      }
      return;
    }

    sendJson(response, 404, { error: "未找到该本地页面路由。" });
  } catch (error) {
    if (!response.headersSent) sendJson(response, 500, { error: safeError(error) });
    else response.destroy();
  }
});

server.timeout = 0;
server.listen(Number(process.env.PORT || 0), "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本地服务未能监听 TCP 端口。");
  const url = "http://127.0.0.1:" + address.port + "/";
  process.stdout.write("视频摘要测试页面已启动：" + url + "\n");
  if (process.platform === "darwin") {
    const opener = spawn("open", [url], { detached: true, stdio: "ignore" });
    opener.on("error", () => {});
    opener.unref();
  }
});

server.on("error", (error) => {
  process.stderr.write("本地摘要服务启动失败：" + safeError(error) + "\n");
  process.exitCode = 1;
});
