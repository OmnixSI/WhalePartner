import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";

const expectedDataDirectory = resolve(process.env.WP_TTS_QA_DATA_DIR ?? "");
const outputPath = resolve(process.env.WP_TTS_CALIBRATION_OUTPUT ?? "docs/evidence/voice/qwen3-tts-100-sentence-calibration.json");
const blockSeconds = 2;
const reserveBlocks = 1;
const standardRtf = 1.2;
const rtfHeadroom = 0.15;
const planningRtf = standardRtf + rtfHeadroom;
const warmTimeoutMs = 5 * 60_000;
const topics = ["天气", "工作", "学习", "旅行", "做饭", "音乐", "阅读", "朋友", "周末", "睡眠"];
const templates = [
  (topic) => `${topic}真不错。`,
  (topic) => `我们聊聊${topic}吧。`,
  (topic) => `我最近一直在想${topic}。`,
  (topic) => `你觉得${topic}最让人放松的地方是什么？`,
  (topic) => `关于${topic}，我最近遇到了一点小问题，想听听你的建议。`,
  (topic) => `要是今天有一整天空闲时间，我想把它留给${topic}，慢慢安排，不着急赶进度。`,
  (topic) => `我有时候会因为${topic}想得太多，反而忘了先做最简单的一步。`,
  (topic) => `你能不能给我一个很具体、今天就可以尝试的${topic}小建议？`,
  (topic) => `刚才我在想${topic}，突然发现那些看起来普通的小事，也能让一天变得很有意思。`,
  (topic) => `要是把最近的${topic}重新安排一次，我会先从最重要的一件事开始，然后留一点时间休息。`,
];

function findRunningTauriApi() {
  if (!expectedDataDirectory || expectedDataDirectory === resolve(".")) {
    throw new Error("WP_TTS_QA_DATA_DIR must name the isolated WhalePartner QA app data directory.");
  }
  const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const row = processes.split("\n").find((line) => /whale-node/i.test(line) && /Resources\/api\/dist\/server\.mjs/i.test(line));
  const pid = row?.trim().split(/\s+/, 1)[0];
  if (!pid) throw new Error("The WhalePartner Tauri QA app is not running its bundled API.");
  const command = execFileSync("ps", ["eww", "-p", pid, "-o", "command="], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const dataPath = command.match(/(?:^|\s)WP_DATA_DIR=(.*?)\s+WP_LOCAL_TOKEN=/s)?.[1];
  const port = command.match(/(?:^|\s)API_PORT=(\d+)/)?.[1];
  const token = command.match(/(?:^|\s)WP_LOCAL_TOKEN=([^\s]+)/)?.[1];
  if (resolve(dataPath ?? "") !== expectedDataDirectory) throw new Error("The running WhalePartner app is not using the isolated QA data directory.");
  if (!port || !token) throw new Error("The running WhalePartner API did not expose its local port and token.");
  return { origin: `http://127.0.0.1:${port}`, headers: { authorization: `Bearer ${token}` } };
}

function makeSentences() {
  const sentences = [];
  for (const topic of topics) {
    for (const template of templates) sentences.push(template(topic));
  }
  let seed = 0x93_20_26;
  for (let index = sentences.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) & 0x7fff_ffff;
    const swapIndex = seed % (index + 1);
    [sentences[index], sentences[swapIndex]] = [sentences[swapIndex], sentences[index]];
  }
  return sentences;
}

function spokenCharacters(text) {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function playbackStartTargetForCharacters(characterCount, secondsPerCharacter, targetRtf) {
  const estimatedAudioSeconds = characterCount * secondsPerCharacter;
  const estimatedGenerationSeconds = estimatedAudioSeconds * targetRtf;
  const targetWaitSeconds = Math.max(0, estimatedGenerationSeconds + blockSeconds - estimatedAudioSeconds);
  return {
    estimatedAudioSeconds,
    estimatedGenerationSeconds,
    targetWaitSeconds,
    targetPcmBufferSeconds: targetWaitSeconds / targetRtf,
  };
}

async function synthesize(origin, headers, text, index) {
  const requestedAt = performance.now();
  const response = await fetch(`${origin}/api/voice/tts/stream`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ text, turnId: `tts-calibration-${index + 1}`, segmentIndex: index, emotion: "neutral", characterId: "deepseek" }),
  });
  if (!response.ok || !response.body) throw new Error(`TTS request ${index + 1} failed with HTTP ${response.status}.`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let audioDurationMs = 0;
  let chunkCount = 0;
  let firstChunkAt = null;
  let previousChunkAt = null;
  let maxChunkGapMs = 0;
  let model = "";
  try {
    while (true) {
      const result = await reader.read();
      carry += decoder.decode(result.value, { stream: !result.done });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === "meta") model = message.model ?? model;
        else if (message.type === "audio") {
          const chunkAt = performance.now();
          firstChunkAt ??= chunkAt;
          if (previousChunkAt !== null) maxChunkGapMs = Math.max(maxChunkGapMs, chunkAt - previousChunkAt);
          previousChunkAt = chunkAt;
          audioDurationMs += message.audioDurationMs ?? 0;
          chunkCount += 1;
        } else if (message.type === "error") throw new Error(message.message || `TTS request ${index + 1} failed.`);
      }
      if (result.done) break;
    }
    if (carry.trim()) {
      const message = JSON.parse(carry);
      if (message.type === "meta") model = message.model ?? model;
      else if (message.type === "audio") {
        const chunkAt = performance.now();
        firstChunkAt ??= chunkAt;
        if (previousChunkAt !== null) maxChunkGapMs = Math.max(maxChunkGapMs, chunkAt - previousChunkAt);
        previousChunkAt = chunkAt;
        audioDurationMs += message.audioDurationMs ?? 0;
        chunkCount += 1;
      } else if (message.type === "error") throw new Error(message.message || `TTS request ${index + 1} failed.`);
    }
  } finally {
    reader.releaseLock();
  }
  if (audioDurationMs <= 0) throw new Error(`TTS request ${index + 1} returned no audio.`);
  const generationMs = performance.now() - requestedAt;
  const characterCount = spokenCharacters(text);
  return {
    index: index + 1,
    text,
    characterCount,
    audioDurationMs: round(audioDurationMs, 1),
    generationMs: round(generationMs, 1),
    rtf: round(generationMs / audioDurationMs, 4),
    firstChunkMs: round((firstChunkAt ?? performance.now()) - requestedAt, 1),
    maxChunkGapMs: round(maxChunkGapMs, 1),
    twoSecondBlocks: Math.ceil(audioDurationMs / (blockSeconds * 1000)),
    secondsPerTenCharacters: round(audioDurationMs / 1000 / characterCount * 10, 3),
    chunkCount,
    model,
  };
}

const { origin, headers } = findRunningTauriApi();
const warmStartedAt = performance.now();
let status;
while (performance.now() - warmStartedAt < warmTimeoutMs) {
  const statusResponse = await fetch(`${origin}/api/voice/tts/status`, { headers });
  if (!statusResponse.ok) throw new Error(`Cannot read the running app's TTS status (HTTP ${statusResponse.status}).`);
  status = await statusResponse.json();
  if (status.state === "ready") break;
  if (status.state === "failed") throw new Error(`The running app's TTS worker failed to warm: ${status.message}`);
  if (Math.floor((performance.now() - warmStartedAt) / 15_000) > Math.floor((performance.now() - warmStartedAt - 2_000) / 15_000)) {
    console.log(`Waiting for the app's startup TTS warm-up (${status.state})`);
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
if (status?.state !== "ready" || !/1\.7B.*4-bit/i.test(status.model)) {
  throw new Error(`Expected a ready WhalePartner 1.7B 4-bit MLX model; got ${status?.model} (${status?.state}).`);
}
const warmWaitMs = performance.now() - warmStartedAt;

const sentences = makeSentences();
if (sentences.length !== 100) throw new Error(`Expected 100 calibration sentences, received ${sentences.length}.`);
const samples = [];
for (let idx = 0; idx < sentences.length; idx += 1) {
  samples.push(await synthesize(origin, headers, sentences[idx], idx));
  if ((idx + 1) % 10 === 0) {
    console.log(`Completed ${idx + 1}/100 sentences`);
    const interim = {
      date: new Date().toISOString(),
      model: status.model,
      sampleCount: samples.length,
      samples,
    };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(interim, null, 2)}\n`);
  }
}

const totalCharacters = samples.reduce((total, sample) => total + sample.characterCount, 0);
const totalAudioMs = samples.reduce((total, sample) => total + sample.audioDurationMs, 0);
const totalGenerationMs = samples.reduce((total, sample) => total + sample.generationMs, 0);
const rtfValues = samples.map((sample) => sample.rtf);
const firstChunkValues = samples.map((sample) => sample.firstChunkMs);
const secondsPerCharacter = round(totalAudioMs / 1000 / totalCharacters, 3);
const averageRtf = round(totalGenerationMs / totalAudioMs, 4);
const measuredSpeechBlocks = Math.ceil(totalAudioMs / (blockSeconds * 1000));
const actualTtsChunks = samples.reduce((total, sample) => total + sample.chunkCount, 0);
const sentenceTwoSecondBlocks = samples.reduce((total, sample) => total + sample.twoSecondBlocks, 0);
const systemInfo = {
  osVersion: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(),
  chip: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim(),
  machine: execFileSync("sysctl", ["-n", "hw.model"], { encoding: "utf8" }).trim(),
  memoryBytes: Number(execFileSync("sysctl", ["-n", "hw.memsize"], { encoding: "utf8" }).trim()),
};
const qaDataDirectory = expectedDataDirectory.startsWith(`${homedir()}/`)
  ? `~/${expectedDataDirectory.slice(homedir().length + 1)}`
  : expectedDataDirectory;
const databaseCounts = execFileSync("sqlite3", [
  "-readonly",
  join(expectedDataDirectory, "app.db"),
  "SELECT (SELECT count(*) FROM chat_sessions) || '|' || (SELECT count(*) FROM messages) || '|' || (SELECT count(*) FROM usage_ledger);",
], { encoding: "utf8" }).trim().split("|").map(Number);
if (databaseCounts.length !== 3 || databaseCounts.some((count) => !Number.isInteger(count))) {
  throw new Error("Could not verify that the isolated QA database stayed free of chat and usage records.");
}
const result = {
  date: new Date().toISOString(),
  runtime: "WhalePartner macOS Tauri QA app via its bundled local TTS API",
  device: systemInfo,
  model: status.model,
  sampleCount: samples.length,
  readyWaitBeforeCalibrationSeconds: round(warmWaitMs / 1000, 1),
  streamingIntervalSeconds: blockSeconds,
  spokenCharacterDefinition: "Unicode letters and numbers; whitespace and punctuation excluded",
  persistence: "TTS streaming endpoint only; no chat request or WAV file; the isolated QA app created its own database on startup",
  databaseIsolation: {
    appIdentifier: "com.omnixsi.whalepartner.voiceqa",
    dataDirectory: qaDataDirectory,
    formalAppDatabaseOpened: false,
    chatRequests: 0,
    audioFilesSaved: 0,
    qaChatSessions: databaseCounts[0],
    qaMessages: databaseCounts[1],
    qaUsageLedgerEntries: databaseCounts[2],
  },
  summary: {
    totalCharacters,
    minSentenceCharacters: Math.min(...samples.map((sample) => sample.characterCount)),
    medianSentenceCharacters: percentile(samples.map((sample) => sample.characterCount), 0.5),
    p90SentenceCharacters: percentile(samples.map((sample) => sample.characterCount), 0.9),
    maxSentenceCharacters: Math.max(...samples.map((sample) => sample.characterCount)),
    totalAudioSeconds: round(totalAudioMs / 1000, 2),
    totalGenerationSeconds: round(totalGenerationMs / 1000, 2),
    weightedCharactersPerSecond: round(totalCharacters / (totalAudioMs / 1000), 3),
    secondsPerTenCharacters: round(secondsPerCharacter * 10, 3),
    weightedAverageRtf: round(averageRtf, 4),
    medianSentenceRtf: round(percentile(rtfValues, 0.5), 4),
    p90SentenceRtf: round(percentile(rtfValues, 0.9), 4),
    medianFirstChunkSeconds: round(percentile(firstChunkValues, 0.5) / 1000, 3),
    p90FirstChunkSeconds: round(percentile(firstChunkValues, 0.9) / 1000, 3),
    maxObservedChunkGapSeconds: round(Math.max(...samples.map((sample) => sample.maxChunkGapMs)) / 1000, 3),
    measuredSpeechBlocks,
    measuredSpeechBlocksWithReserve: measuredSpeechBlocks + reserveBlocks,
    sumOfPerSentenceTwoSecondBlocks: sentenceTwoSecondBlocks,
    actualTtsChunks,
    reserveBlocks,
  },
  bufferStrategy: {
    standardRtf,
    rtfHeadroom,
    planningRtf,
    reserveSeconds: blockSeconds,
    targetWaitFormula: "max(0, estimatedAudioSeconds * planningRtf + reserveSeconds - estimatedAudioSeconds)",
    targetPcmBufferFormula: "targetWaitSeconds / planningRtf",
  },
  bufferExamples: [10, 20, 40, 80, 160].map((characterCount) => {
    const target = playbackStartTargetForCharacters(characterCount, secondsPerCharacter, planningRtf);
    return {
      characterCount,
      estimatedAudioSeconds: round(target.estimatedAudioSeconds, 2),
      estimatedGenerationSeconds: round(target.estimatedGenerationSeconds, 3),
      targetWaitSeconds: round(target.targetWaitSeconds, 3),
      targetPcmBufferSeconds: round(target.targetPcmBufferSeconds, 3),
    };
  }),
  samples,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...result.summary, bufferExamples: result.bufferExamples }, null, 2));
