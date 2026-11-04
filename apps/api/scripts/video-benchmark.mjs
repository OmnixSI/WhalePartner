import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const appDir = resolve(import.meta.dirname, "..");
const repoDir = resolve(appDir, "../..");
const assetRoot = resolve(repoDir, ".local/video-summaries");
const bvidList = [
  "BV1ENaD69Eka",
  "BV1Ngxy6vEHk",
  "BV1orxT6mEYV",
  "BV1R5nZ66Eq6",
  "BV12Dxy6TEfm",
  "BV1nDnz6PECH",
  "BV1bhp76sE9s",
  "BV1tWY16FEtX",
  "BV1KdHY68Ems",
  "BV1Rx411j7p8",
];
const columnList = [
  "sequence",
  "bvid",
  "title",
  "uploader",
  "videoDurationSeconds",
  "status",
  "measuredAt",
  "transcriptSource",
  "transcriptCharacters",
  "transcriptSegments",
  "transcriptNote",
  "commentsTotal",
  "commentsFetched",
  "danmakuTotal",
  "danmakuSamples",
  "framesSaved",
  "framesFailed",
  "frameErrors",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "promptCharacters",
  "summaryCharacters",
  "evidenceCollectionMs",
  "extractorElapsedSeconds",
  "videoIdResolutionMs",
  "videoMetadataMs",
  "transcriptAndAsrMs",
  "keyframeExtractionMs",
  "commentsMs",
  "danmakuMs",
  "commentsAndDanmakuMs",
  "visionMs",
  "sourceArtifactWriteMs",
  "promptBuildMs",
  "codexSummaryMs",
  "summaryArtifactWriteMs",
  "pipelineToSummaryReadyMs",
  "sessionSetupMs",
  "inputToSummaryReadyMs",
  "interVideoWaitMs",
  "postExtractionToUsageWriteSecondsApprox",
  "stageTimingStatus",
  "assetDirectory",
  "sourceJson",
  "summaryMarkdown",
  "usageJson",
  "frameFiles",
  "wholeVideoSummary",
  "manualQualityScore",
  "manualNotes",
];

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function parseCsv(text) {
  const rowList = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let idx = 0; idx < text.length; idx += 1) {
    const char = text[idx];
    if (quoted) {
      if (char === '"' && text[idx + 1] === '"') {
        cell += '"';
        idx += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rowList.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rowList.push(row);
  }
  if (rowList.length === 0) return [];

  const headerList = rowList.shift();
  return rowList.map((valueList) => Object.fromEntries(
    headerList.map((header, idx) => [header, valueList[idx] ?? ""]),
  ));
}

function runPipeline() {
  return new Promise((resolveRun, rejectRun) => {
    const cliPath = resolve(appDir, "src/cli.ts");
    const child = spawn(process.execPath, [cliPath, "summarize", "--", ...bvidList], {
      cwd: appDir,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`Video pipeline exited with ${signal ?? `code ${code}`}.`));
      }
    });
  });
}

async function readReviewValues(csvPath) {
  try {
    const oldText = await readFile(csvPath, "utf8");
    const oldRows = parseCsv(oldText);
    return new Map(oldRows.map((row) => [row.bvid, {
      manualQualityScore: row.manualQualityScore ?? "",
      manualNotes: row.manualNotes ?? "",
    }]));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

function elapsedAfterEvidence(usage) {
  const timing = usage.timing ?? {};
  if (typeof timing.pipelineToSummaryReadyMs === "number" && typeof timing.evidenceCollectionMs === "number") {
    return Math.max(0, timing.pipelineToSummaryReadyMs - timing.evidenceCollectionMs) / 1000;
  }
  return "";
}

async function readVideoRow(sequence, bvid, reviewMap) {
  const assetDir = resolve(assetRoot, bvid);
  const sourcePath = resolve(assetDir, "source.json");
  const usagePath = resolve(assetDir, "usage.json");
  const summaryPath = resolve(assetDir, "summary.md");
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const usage = JSON.parse(await readFile(usagePath, "utf8"));
  const summary = await readFile(summaryPath, "utf8");
  const tokenUsage = usage.tokenUsage ?? {};
  const evidenceStages = source.stageTimings ?? {};
  const timing = usage.timing ?? {};
  const frameErrorList = (source.frames?.results ?? [])
    .filter((frame) => frame.error)
    .map((frame) => `${frame.time}s: ${frame.error}`);
  const framePathList = (source.frameImages ?? [])
    .filter((frame) => frame.path)
    .map((frame) => relative(repoDir, frame.path));
  const review = reviewMap.get(bvid) ?? { manualQualityScore: "", manualNotes: "" };

  return {
    sequence,
    bvid,
    title: source.metadata?.title ?? "",
    uploader: source.metadata?.uploader?.name ?? "",
    videoDurationSeconds: source.metadata?.duration ?? "",
    status: summary.trim() ? "summarized" : "missing-summary",
    measuredAt: source.fetchedAt ?? "",
    transcriptSource: source.transcript?.source ?? "none",
    transcriptCharacters: source.transcript?.text?.length ?? 0,
    transcriptSegments: source.transcript?.segments?.length ?? 0,
    transcriptNote: source.transcript?.note ?? "",
    commentsTotal: source.comments?.total ?? 0,
    commentsFetched: source.comments?.fetched ?? 0,
    danmakuTotal: source.danmaku?.total ?? 0,
    danmakuSamples: source.danmaku?.samples?.length ?? 0,
    framesSaved: source.frameImages?.length ?? 0,
    framesFailed: frameErrorList.length,
    frameErrors: frameErrorList.join(" | "),
    inputTokens: tokenUsage.inputTokens ?? "",
    cachedInputTokens: tokenUsage.cachedInputTokens ?? "",
    outputTokens: tokenUsage.outputTokens ?? "",
    promptCharacters: usage.promptCharacters ?? "",
    summaryCharacters: usage.summaryCharacters ?? "",
    evidenceCollectionMs: timing.evidenceCollectionMs ?? "",
    extractorElapsedSeconds: source.elapsedSeconds ?? "",
    videoIdResolutionMs: evidenceStages.videoIdResolutionMs ?? "",
    videoMetadataMs: evidenceStages.videoMetadataMs ?? "",
    transcriptAndAsrMs: evidenceStages.transcriptAndAsrMs ?? "",
    keyframeExtractionMs: evidenceStages.keyframeExtractionMs ?? "",
    commentsMs: evidenceStages.commentsMs ?? "",
    danmakuMs: evidenceStages.danmakuMs ?? "",
    commentsAndDanmakuMs: evidenceStages.commentsAndDanmakuMs ?? "",
    visionMs: evidenceStages.visionMs ?? "",
    sourceArtifactWriteMs: timing.sourceArtifactWriteMs ?? "",
    promptBuildMs: timing.promptBuildMs ?? "",
    codexSummaryMs: timing.codexSummaryMs ?? "",
    summaryArtifactWriteMs: timing.summaryArtifactWriteMs ?? "",
    pipelineToSummaryReadyMs: timing.pipelineToSummaryReadyMs ?? "",
    sessionSetupMs: timing.sessionSetupMs ?? "",
    inputToSummaryReadyMs: timing.inputToSummaryReadyMs ?? "",
    interVideoWaitMs: timing.interVideoWaitMs ?? "",
    postExtractionToUsageWriteSecondsApprox: elapsedAfterEvidence(usage),
    stageTimingStatus: Object.keys(evidenceStages).length > 0 ? "measured" : "not recorded",
    assetDirectory: relative(repoDir, assetDir),
    sourceJson: relative(repoDir, sourcePath),
    summaryMarkdown: relative(repoDir, summaryPath),
    usageJson: relative(repoDir, usagePath),
    frameFiles: framePathList.join("; "),
    wholeVideoSummary: summary.trim().replace(/\r?\n/g, " "),
    manualQualityScore: review.manualQualityScore,
    manualNotes: review.manualNotes,
  };
}

async function exportCsv() {
  const date = new Date();
  const dateStamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const csvPath = resolve(assetRoot, `benchmark_${dateStamp}.csv`);
  const reviewMap = await readReviewValues(csvPath);
  const rowList = [];
  for (let idx = 0; idx < bvidList.length; idx += 1) {
    rowList.push(await readVideoRow(idx + 1, bvidList[idx], reviewMap));
  }
  const csvLines = [columnList.join(",")];
  for (const row of rowList) {
    const cellList = [];
    for (const column of columnList) cellList.push(csvCell(row[column]));
    csvLines.push(cellList.join(","));
  }
  await writeFile(csvPath, `${csvLines.join("\r\n")}\r\n`);

  const inputTokens = rowList.reduce((total, row) => total + Number(row.inputTokens || 0), 0);
  const cachedInputTokens = rowList.reduce((total, row) => total + Number(row.cachedInputTokens || 0), 0);
  const outputTokens = rowList.reduce((total, row) => total + Number(row.outputTokens || 0), 0);
  const totalInputToReadyMs = rowList.reduce((total, row) => total + Number(row.inputToSummaryReadyMs || 0), 0);
  const totalPipelineMs = rowList.reduce((total, row) => total + Number(row.pipelineToSummaryReadyMs || 0), 0);
  const totalInterVideoWaitMs = rowList.reduce((total, row) => total + Number(row.interVideoWaitMs || 0), 0);
  const sessionSetupMs = Math.max(...rowList.map((row) => Number(row.sessionSetupMs || 0)));
  const sortedReadyTimes = rowList
    .map((row) => Number(row.inputToSummaryReadyMs || 0))
    .sort((left, right) => left - right);
  const middle = Math.floor(sortedReadyTimes.length / 2);
  const medianInputToReadyMs = sortedReadyTimes.length % 2 === 0
    ? (sortedReadyTimes[middle - 1] + sortedReadyTimes[middle]) / 2
    : sortedReadyTimes[middle];
  const frameCount = rowList.reduce((total, row) => total + Number(row.framesSaved || 0), 0);
  const failedFrameCount = rowList.reduce((total, row) => total + Number(row.framesFailed || 0), 0);
  const commentCount = rowList.reduce((total, row) => total + Number(row.commentsFetched || 0), 0);
  const danmakuSampleCount = rowList.reduce((total, row) => total + Number(row.danmakuSamples || 0), 0);
  process.stdout.write(`Benchmark CSV: ${csvPath}\n`);
  process.stdout.write(`Rows: ${rowList.length}; input tokens: ${inputTokens} (${cachedInputTokens} cached); output tokens: ${outputTokens}; total: ${inputTokens + outputTokens}.\n`);
  process.stdout.write(`Single-video input-to-summary estimate: ${(totalInputToReadyMs / 1000).toFixed(2)}s summed; ${(totalInputToReadyMs / rowList.length / 1000).toFixed(2)}s average; ${(medianInputToReadyMs / 1000).toFixed(2)}s median.\n`);
  process.stdout.write(`Batch estimate including one session setup and inter-video waits: ${((totalPipelineMs + sessionSetupMs + totalInterVideoWaitMs) / 1000).toFixed(2)}s.\n`);
  process.stdout.write(`Evidence: ${frameCount} saved frames, ${failedFrameCount} failed frames, ${commentCount} fetched comments, ${danmakuSampleCount} danmaku samples.\n`);
}

async function main(args) {
  const csvPath = resolve(assetRoot, `benchmark_${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}.csv`);
  if (!args.includes("--export-only")) await runPipeline();
  await exportCsv();
  process.stdout.write(`Preserved manual review values from ${csvPath} when they were already present.\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
