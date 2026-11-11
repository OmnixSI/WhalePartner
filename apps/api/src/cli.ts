import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { assertBilibiliRequestAllowed, collectBilibiliVideoEvidence } from "./bilibili/video.ts";
import {
  bilibiliSessionPath,
  isBilibiliSessionValid,
  loadBilibiliSession,
  logoutFromBilibili,
  startBilibiliLogin,
  waitForBilibiliLogin,
} from "./bilibili/session.ts";
import { summarizeWithCodex } from "./codex/exec.ts";
import { dataDir } from "./server/data-dir.ts";
import { buildVideoSummaryPrompt } from "./video/prompt.ts";

const VIDEO_REQUEST_GAP_MS = 5000;

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function formatSeconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

async function writeSmokeArtifact() {
  const outPath = join(dataDir(), "PLACEHOLDER_smoke.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({ status: "PLACEHOLDER", purpose: "CLI smoke artifact only" }, null, 2) + "\n");
  process.stdout.write(outPath + "\n");
}

type SummaryStatus = "summarized" | "rate-limited" | "insufficient-evidence";

async function summarizeVideo(
  input: string,
  sessdata: string,
  runTiming: { sessionSetupMs: number; interVideoWaitMs: number },
): Promise<SummaryStatus> {
  const pipelineStartedAt = performance.now();
  const evidenceStartedAt = performance.now();
  const source = await collectBilibiliVideoEvidence(input, sessdata);
  const evidenceCollectionMs = elapsedMs(evidenceStartedAt);
  const bvid = source.bvid;
  if (!bvid) throw new Error("提取结果缺少 BV 号，无法保存摘要。");

  const outDir = join(dataDir(), "video-summaries", bvid);
  const setupArtifactStartedAt = performance.now();
  await mkdir(outDir, { recursive: true });
  await rm(resolve(outDir, "summary.md"), { force: true });
  await rm(resolve(outDir, "usage.json"), { force: true });
  await writeFile(resolve(outDir, "source.json"), JSON.stringify(source, null, 2) + "\n");
  const sourceArtifactWriteMs = elapsedMs(setupArtifactStartedAt);

  if (source.frames.error) {
    process.stdout.write(`关键帧提取阶段 ${source.frames.stage ?? "unknown"}：${source.frames.error}\n`);
  }

  if (source.rateLimit.limited) {
    const status = source.rateLimit.status ?? 0;
    const reason = status < 0 ? `风控码 ${status}` : `HTTP ${status}`;
    process.stdout.write(`B 站触发 ${reason}；请求已暂停至 ${source.rateLimit.retryAt}。本次只保存部分提取数据，未生成摘要。\n`);
    return "rate-limited";
  }

  if (!source.transcript.text?.trim() && source.frameImages.length === 0) {
    process.stdout.write(
      `没有取得字幕/转写正文或关键帧，未生成视频摘要。来源和辅助资料已保存：${outDir}\n`,
    );
    return "insufficient-evidence";
  }

  const promptStartedAt = performance.now();
  const prompt = buildVideoSummaryPrompt(source.formattedText, source.frameImages);
  const promptBuildMs = elapsedMs(promptStartedAt);
  const framePaths = source.frameImages.map((frame) => frame.path);
  const codexStartedAt = performance.now();
  const codexResult = await summarizeWithCodex(prompt, framePaths);
  const codexSummaryMs = elapsedMs(codexStartedAt);
  const summaryText = codexResult.message.trim() + "\n";
  const summaryArtifactStartedAt = performance.now();
  await writeFile(resolve(outDir, "summary.md"), summaryText);
  const summaryArtifactWriteMs = elapsedMs(summaryArtifactStartedAt);
  const pipelineToSummaryReadyMs = elapsedMs(pipelineStartedAt);
  await writeFile(
    resolve(outDir, "usage.json"),
    JSON.stringify({
      promptCharacters: prompt.length,
      summaryCharacters: codexResult.message.length,
      tokenUsage: codexResult.usage ?? null,
      exactTokenUsageAvailable: codexResult.usage !== undefined,
      model: codexResult.model,
      reasoningEffort: codexResult.reasoningEffort,
      transcriptSource: source.media.transcriptSource,
      frameCount: source.media.frameCount,
      frameTimes: source.media.frameTimes,
      timing: {
        evidenceCollectionMs,
        evidenceStages: source.stageTimings,
        sourceArtifactWriteMs,
        promptBuildMs,
        codexSummaryMs,
        summaryArtifactWriteMs,
        pipelineToSummaryReadyMs,
        sessionSetupMs: runTiming.sessionSetupMs,
        inputToSummaryReadyMs: pipelineToSummaryReadyMs + runTiming.sessionSetupMs,
        interVideoWaitMs: runTiming.interVideoWaitMs,
      },
    }, null, 2) + "\n",
  );
  process.stdout.write(
    `视频证据：${source.media.transcriptSource === "none" ? "无字幕/转写" : source.media.transcriptSource}，关键帧 ${source.media.frameCount} 张。\n`,
  );
  process.stdout.write(summaryText);
  if (codexResult.usage) {
    process.stdout.write(
      `Codex tokens: input ${codexResult.usage.inputTokens} (cached ${codexResult.usage.cachedInputTokens}), output ${codexResult.usage.outputTokens}.\n`,
    );
  } else {
    process.stdout.write(`Codex token usage unavailable; prompt ${prompt.length} chars, summary ${codexResult.message.length} chars.\n`);
  }
  const evidenceStages = source.stageTimings ?? {};
  const inputToSummaryReadyMs = pipelineToSummaryReadyMs + runTiming.sessionSetupMs;
  process.stdout.write(
    `耗时：资料采集 ${formatSeconds(evidenceCollectionMs)}（BV 定位 ${formatSeconds(evidenceStages.videoIdResolutionMs ?? 0)}、` +
    `元数据 ${formatSeconds(evidenceStages.videoMetadataMs ?? 0)}、` +
    `字幕/ASR ${formatSeconds(evidenceStages.transcriptAndAsrMs ?? 0)}、关键帧 ${formatSeconds(evidenceStages.keyframeExtractionMs ?? 0)}、` +
    `评论 ${formatSeconds(evidenceStages.commentsMs ?? 0)}、弹幕 ${formatSeconds(evidenceStages.danmakuMs ?? 0)}、` +
    `视觉描述 ${formatSeconds(evidenceStages.visionMs ?? 0)}），提示词 ${formatSeconds(promptBuildMs)}、` +
    `Codex 摘要 ${formatSeconds(codexSummaryMs)}、源文件写入 ${formatSeconds(sourceArtifactWriteMs)}、` +
    `摘要写入 ${formatSeconds(summaryArtifactWriteMs)}，` +
    `输入到摘要可用 ${formatSeconds(inputToSummaryReadyMs)}；本项前的批次间隔 ${formatSeconds(runTiming.interVideoWaitMs)}。\n`,
  );
  process.stdout.write("\n已保存提取证据和摘要：" + outDir + "\n");
  return "summarized";
}

async function summarizeVideos(inputs: string[]) {
  const sessionSetupStartedAt = performance.now();
  await assertBilibiliRequestAllowed();
  const session = await loadBilibiliSession();
  if (session && !(await isBilibiliSessionValid(session.sessdata))) {
    throw new Error("本机保存的 B 站登录态已失效，请先运行 pnpm run login。");
  }
  const sessionSetupMs = elapsedMs(sessionSetupStartedAt);

  process.stdout.write(session ? "使用本机 B 站登录态。\n" : "未登录，使用匿名数据。\n");
  let incomplete = false;
  for (const [index, input] of inputs.entries()) {
    let interVideoWaitMs = 0;
    if (index > 0) {
      const waitStartedAt = performance.now();
      await delay(VIDEO_REQUEST_GAP_MS);
      interVideoWaitMs = elapsedMs(waitStartedAt);
    }
    const status = await summarizeVideo(input, session?.sessdata ?? "", { sessionSetupMs, interVideoWaitMs });
    if (status === "rate-limited") {
      process.stdout.write("B 站已触发限流保护，本次停止后续视频请求。等待本机冷却时间结束后再重试。\n");
      incomplete = true;
      break;
    }
    if (status === "insufficient-evidence") incomplete = true;
  }
  if (incomplete) process.exitCode = 1;
}

async function login(args: string[]) {
  await assertBilibiliRequestAllowed();
  if (args[0] === "--wait") {
    await waitForBilibiliLogin(() => process.stdout.write("已扫码，请在 B 站 App 中确认登录。\n"));
    process.stdout.write(`B 站登录成功；凭据保存在本机：${bilibiliSessionPath()}\n`);
    return;
  }

  await startBilibiliLogin((qrPath) => {
    process.stdout.write(`本机二维码已生成：${qrPath}\n请使用 B 站 App 扫码并在手机上确认。\n`);
  });
  process.stdout.write("扫码并在手机上确认后，运行 pnpm --dir apps/api run login -- --wait 完成授权。\n");
}

async function showLoginStatus() {
  await assertBilibiliRequestAllowed();
  const session = await loadBilibiliSession();
  if (!session) {
    process.stdout.write("未登录 B 站。运行 pnpm run login 开始扫码。\n");
    return;
  }
  const valid = await isBilibiliSessionValid(session.sessdata);
  process.stdout.write(valid ? "B 站登录态有效。\n" : "B 站登录态已失效。运行 pnpm run login 重新扫码。\n");
}

async function main() {
  if (process.argv.includes("--smoke")) {
    await writeSmokeArtifact();
    return;
  }

  const args = process.argv.slice(2);
  if (args[0] === "login") {
    await login(args.slice(1));
    return;
  }

  if (args[0] === "status") {
    await showLoginStatus();
    return;
  }

  if (args[0] === "logout") {
    await logoutFromBilibili();
    process.stdout.write("已清除本机 B 站登录态。\n");
    return;
  }

  if (args[0] === "summarize") {
    const inputs = args.slice(1).filter((arg) => arg !== "--");
    if (inputs.length === 0) {
      process.stderr.write("Usage: pnpm run summarize -- <bilibili-url-or-bvid> [url-or-bvid ...]\n");
      process.exitCode = 2;
      return;
    }

    await summarizeVideos(inputs);
    return;
  }

  process.stderr.write(
    "Usage: pnpm run login | status | logout | summarize -- <bilibili-url-or-bvid> [url-or-bvid ...]\n",
  );
  process.exitCode = 2;
}

void main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
