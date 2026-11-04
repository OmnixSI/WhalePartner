import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectBilibiliText } from "./bilibili.ts";
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

async function summarizeVideo(input: string) {
  const source = await collectBilibiliText(input);
  const bvid = source.bvid;
  if (!bvid) throw new Error("提取结果缺少 BV 号，无法保存摘要。");

  const outDir = resolve(repoDir, ".local/video-summaries", bvid);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "source.json"), JSON.stringify(source, null, 2) + "\n");

  const prompt = buildVideoSummaryPrompt(source.formattedText);
  const summary = await summarizeWithCodex(prompt);
  const summaryText = summary.trim() + "\n";
  await writeFile(resolve(outDir, "summary.md"), summaryText);
  process.stdout.write(summaryText);
  process.stdout.write("\n已保存提取证据和摘要：" + outDir + "\n");
}

async function main() {
  if (process.argv.includes("--smoke")) {
    await writeSmokeArtifact();
    return;
  }

  const args = process.argv.slice(2);
  if (args[0] === "summarize") {
    const input = args[1] === "--" ? args[2] : args[1];
    if (!input) {
      process.stderr.write("Usage: pnpm run summarize -- <bilibili-url-or-bvid>\n");
      process.exitCode = 2;
      return;
    }

    await summarizeVideo(input);
    return;
  }

  process.stderr.write("Usage: pnpm run summarize -- <bilibili-url-or-bvid>\n");
  process.exitCode = 2;
}

void main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
