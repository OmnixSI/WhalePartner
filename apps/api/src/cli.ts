import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertBilibiliRequestAllowed, collectBilibiliVideoEvidence } from "./bilibili.ts";
import {
  bilibiliSessionPath,
  isBilibiliSessionValid,
  loadBilibiliSession,
  logoutFromBilibili,
  startBilibiliLogin,
  waitForBilibiliLogin,
} from "./bilibili-session.ts";
import { summarizeWithCodex } from "./codex.ts";
import { buildVideoSummaryPrompt } from "./prompt.ts";

const appDir = resolve(import.meta.dirname, "..");
const repoDir = resolve(appDir, "../..");

async function writeSmokeArtifact() {
  const outPath = resolve(repoDir, ".local/PLACEHOLDER_smoke.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({ status: "PLACEHOLDER", purpose: "CLI smoke artifact only" }, null, 2) + "\n");
  process.stdout.write(outPath + "\n");
}

type SummaryStatus = "summarized" | "rate-limited" | "insufficient-evidence";

async function summarizeVideo(input: string, sessdata: string): Promise<SummaryStatus> {
  const source = await collectBilibiliVideoEvidence(input, sessdata);
  const bvid = source.bvid;
  if (!bvid) throw new Error("提取结果缺少 BV 号，无法保存摘要。");

  const outDir = resolve(repoDir, ".local/video-summaries", bvid);
  await mkdir(outDir, { recursive: true });
  await rm(resolve(outDir, "summary.md"), { force: true });
  await rm(resolve(outDir, "usage.json"), { force: true });
  await writeFile(resolve(outDir, "source.json"), JSON.stringify(source, null, 2) + "\n");

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

  const prompt = buildVideoSummaryPrompt(source.formattedText, source.frameImages);
  const framePaths = source.frameImages.map((frame) => frame.path);
  const codexResult = await summarizeWithCodex(prompt, framePaths);
  const summaryText = codexResult.message.trim() + "\n";
  await writeFile(resolve(outDir, "summary.md"), summaryText);
  await writeFile(
    resolve(outDir, "usage.json"),
    JSON.stringify({
      promptCharacters: prompt.length,
      summaryCharacters: codexResult.message.length,
      tokenUsage: codexResult.usage ?? null,
      exactTokenUsageAvailable: codexResult.usage !== undefined,
      model: "gpt-6-luna",
      reasoningEffort: "minimal",
      transcriptSource: source.media.transcriptSource,
      frameCount: source.media.frameCount,
      frameTimes: source.media.frameTimes,
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
  process.stdout.write("\n已保存提取证据和摘要：" + outDir + "\n");
  return "summarized";
}

async function summarizeVideos(inputs: string[]) {
  await assertBilibiliRequestAllowed();
  const session = await loadBilibiliSession();
  if (session && !(await isBilibiliSessionValid(session.sessdata))) {
    throw new Error("本机保存的 B 站登录态已失效，请先运行 pnpm run login。");
  }

  process.stdout.write(session ? "使用本机 B 站登录态。\n" : "未登录，使用匿名数据。\n");
  let incomplete = false;
  for (const input of inputs) {
    const status = await summarizeVideo(input, session?.sessdata ?? "");
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
