import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const clientDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiOrigin = "http://127.0.0.1:8787";
const sampleRate = 24_000;
const prerollSeconds = 1.44;
const characterId = "deepseek";
const emotion = "neutral";
const beforeSegments = [
  "第一句话我们先把播放状态和声音生成分开观察，确认每一段真实语音什么时候到达。",
  "第二句话会继续检查缓冲是否能够支撑连续播放，以及句子之间有没有额外空白。",
  "第三句话会记录整轮完成、声音排空和欠载恢复的准确时间。",
];
const longSpeechSegments = [
  "今天我们把语音播放过程完整地走一遍，先观察每个声音片段生成和到达的时间。",
  "模型会根据这些自然完整的句子连续生成声音，应用再把音频依次交给播放设备。",
  "只要生成速度能够跟上播放速度，整段话就会平稳连贯，不会被句子边界切断。",
  "接下来我们逐句记录音频长度和缓冲余量，确认声音中断是来自模型还是播放状态。",
  "如果缓冲被消耗完，工作线程会记录欠载开始和恢复时间，方便计算实际静音长度。",
  "我们还会检查每句话的停顿是否符合标点语气，而不是播放队列意外耗尽造成的空白。",
  "当最后一句完成后，系统只会结束一次整轮播放，确保音频队列排空后才复位状态。",
  "用户开口打断时，旧轮次的声音会立即停止，未完成的合成会取消，队列也会清空。",
  "快速开启下一轮时，新声音只会使用新的轮次编号，不会混进上一轮留下的音频。",
  "本次记录只统计这台 Mac 上真实运行的本地模型和真实 Web Audio 播放处理结果。",
];

function findLocalToken() {
  const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const row = processes.split("\n").find((line) => line.includes("whale-node") && line.includes("Resources/api/dist/server.mjs") && line.includes("WhalePartner"));
  const pid = row?.trim().split(/\s+/, 1)[0];
  if (!pid) return "";
  const command = execFileSync("ps", ["eww", "-p", pid, "-o", "command="], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  return command.match(/(?:^|\s)WP_LOCAL_TOKEN=([^\s]+)/)?.[1] ?? "";
}

function createWav(pcm, rate) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

function assertRecordingDuration(recording, expectedDurationMs, scenarioId) {
  const actualDurationMs = recording.pcm.reduce((total, pcm) => total + pcm.length, 0) / 2 / recording.sampleRate * 1000;
  assert.ok(Math.abs(actualDurationMs - expectedDurationMs) < 1, `${scenarioId} WAV PCM must match the samples played by AudioWorklet`);
  return actualDurationMs;
}

function summarize(result) {
  const {
    scenarioId,
    finishEachSegment,
    segmentCount,
    elapsedMs,
    wallThroughDrainMs,
    audioDurationMs,
    rtf,
    firstAudioMs,
    firstAudibleMs,
    segmentMetrics,
    segmentBoundaryGapsMs,
    pcmBoundarySilenceMs,
    sentenceSilenceMs,
    workletStartCount,
    workletDrainCount,
    underrunCount,
    underrunSilenceMs,
    restartSilenceMs,
    totalInterSentenceSilenceMs,
    nonSilentAnalyserFrames,
    allSegmentsCompleted,
  } = result;
  return {
    scenarioId,
    finishEachSegment,
    segmentCount,
    elapsedMs,
    wallThroughDrainMs,
    audioDurationMs,
    rtf,
    firstAudioMs,
    firstAudibleMs,
    segmentMetrics,
    segmentBoundaryGapsMs,
    pcmBoundarySilenceMs,
    sentenceSilenceMs,
    workletStartCount,
    workletDrainCount,
    underrunCount,
    underrunSilenceMs,
    restartSilenceMs,
    totalInterSentenceSilenceMs,
    nonSilentAnalyserFrames,
    allSegmentsCompleted,
  };
}

function batchQueuedSentences(sentences, maxTextLength = 180) {
  if (sentences.length === 0) return [];
  const requests = [sentences[0]];
  let queuedText = "";
  for (const sentence of sentences.slice(1)) {
    const separator = /[A-Za-z0-9.!?;:)'\]。！？；：]$/.test(queuedText) && /^[A-Za-z0-9("'\[]/.test(sentence) ? " " : "";
    const combined = queuedText + separator + sentence;
    if (queuedText && combined.length > maxTextLength) {
      requests.push(queuedText);
      queuedText = sentence;
    } else {
      queuedText = combined;
    }
  }
  if (queuedText) requests.push(queuedText);
  return requests;
}

const token = findLocalToken();
const authHeaders = token ? { authorization: "Bearer " + token } : {};
const statusResponse = await fetch(apiOrigin + "/api/voice/tts/status", { headers: authHeaders });
assert.equal(statusResponse.status, 200, "the running local TTS service must be reachable");
const status = await statusResponse.json();
assert.equal(status.state, "ready", "the real local TTS model must be ready before this test starts");
assert.match(status.model, /Qwen3-TTS/, "the playback benchmark must use the real Qwen3-TTS service");

const server = await createServer({
  configFile: resolve(clientDir, "vite.config.ts"),
  root: clientDir,
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  logLevel: "error",
});
let browser;
const recordings = new Map();
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object", "Vite did not expose a local test port");
  browser = await chromium.launch({
    headless: process.env.WP_VOICE_HEADFUL !== "1",
    args: ["--autoplay-policy=no-user-gesture-required"],
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("Browser error:", error.message));
  await page.exposeFunction("recordVoicePcm", ({ scenarioId, pcm16Chunks, sampleRate: rate }) => {
    const current = recordings.get(scenarioId) ?? { pcm: [], sampleRate: rate };
    current.pcm.push(...pcm16Chunks.map((pcm16) => Buffer.from(pcm16, "base64")));
    recordings.set(scenarioId, current);
  });
  await page.goto("http://127.0.0.1:" + address.port, { waitUntil: "domcontentloaded" });

  const run = async (scenarioId, segments, finishEachSegment) => page.evaluate(async ({ scenarioId, segments, finishEachSegment, token, sampleRate, prerollSeconds, characterId, emotion }) => {
    const context = new AudioContext({ latencyHint: "interactive", sampleRate });
    await context.resume();
    await context.audioWorklet.addModule("/src/components/chat/pcm-playback-worklet.ts");
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(context.destination);
    const node = new AudioWorkletNode(context, "whale-pcm-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.connect(analyser);
    const events = [];
    const waveform = new Float32Array(analyser.fftSize);
    let waveformFrames = 0;
    let nonSilentFrames = 0;
    const monitor = window.setInterval(() => {
      analyser.getFloatTimeDomainData(waveform);
      waveformFrames += 1;
      if (waveform.some((sample) => Math.abs(sample) > 0.01)) nonSilentFrames += 1;
    }, 20);
    node.port.onmessage = ({ data }) => events.push({ ...data, atMs: performance.now() });
    node.port.postMessage({ type: "configure", prerollSamples: Math.ceil(sampleRate * prerollSeconds) });

    const requestStartedAt = performance.now();
    const segmentMetrics = [];
    let totalAudioSamples = 0;
    let firstAudioMs = null;
    let doneCount = 0;
    const pcm16Chunks = [];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segmentStartedAt = performance.now();
      const response = await fetch("/api/voice/tts/stream", {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, token ? { authorization: "Bearer " + token } : {}),
        body: JSON.stringify({ text: segments[segmentIndex], turnId: scenarioId, segmentIndex, characterId, emotion }),
      });
      if (!response.ok || !response.body) throw new Error("TTS request failed: HTTP " + response.status);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let carry = "";
      let chunkIndex = 0;
      let segmentFirstAudioMs = null;
      let segmentAudioSamples = 0;
      let segmentDoneAt = null;
      let firstNonSilentSample = null;
      let lastNonSilentSample = null;
      const modelChunkElapsedMs = [];
      const handleLine = async (line) => {
        if (!line.trim()) return;
        const message = JSON.parse(line);
        if (message.type === "error") throw new Error(message.message || "TTS synthesis failed");
        if (message.type === "audio") {
          const arrivedAt = performance.now();
          if (firstAudioMs === null) firstAudioMs = arrivedAt - requestStartedAt;
          if (segmentFirstAudioMs === null) segmentFirstAudioMs = arrivedAt - segmentStartedAt;
          const pcm = atob(message.pcm16);
          const samples = new Float32Array(Math.floor(pcm.length / 2));
          for (let index = 0; index < samples.length; index += 1) {
            const value = pcm.charCodeAt(index * 2) | (pcm.charCodeAt(index * 2 + 1) << 8);
            samples[index] = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
          }
          totalAudioSamples += samples.length;
          pcm16Chunks.push(message.pcm16);
          if (Number.isFinite(message.elapsedMs)) modelChunkElapsedMs.push(message.elapsedMs);
          for (let sample = 0; sample < samples.length; sample += 1) {
            if (Math.abs(samples[sample]) > 0.002) {
              firstNonSilentSample ??= segmentAudioSamples + sample;
              lastNonSilentSample = segmentAudioSamples + sample;
            }
          }
          segmentAudioSamples += samples.length;
          node.port.postMessage({ type: "push", samples, turnId: scenarioId, segmentIndex, chunkIndex }, [samples.buffer]);
          chunkIndex += 1;
        } else if (message.type === "done") {
          segmentDoneAt = performance.now();
          doneCount += 1;
          node.port.postMessage({ type: "segment-done", turnId: scenarioId, segmentIndex });
          if (finishEachSegment) node.port.postMessage({ type: "finish", turnId: scenarioId });
        }
      };
      while (true) {
        const result = await reader.read();
        carry += decoder.decode(result.value, { stream: !result.done });
        const lines = carry.split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) await handleLine(line);
        if (result.done) break;
      }
      await handleLine(carry);
      if (segmentDoneAt === null) throw new Error("TTS stream ended without a done event");
      segmentMetrics.push({
        segmentIndex,
        textLength: segments[segmentIndex].length,
        firstAudioMs: segmentFirstAudioMs,
        elapsedMs: segmentDoneAt - segmentStartedAt,
        audioDurationMs: segmentAudioSamples / sampleRate * 1000,
        chunkCount: chunkIndex,
        firstChunkElapsedMs: modelChunkElapsedMs[0] ?? null,
        averageChunkIntervalMs: modelChunkElapsedMs.length > 1
          ? (modelChunkElapsedMs.at(-1) - modelChunkElapsedMs[0]) / (modelChunkElapsedMs.length - 1)
          : null,
        leadingSilenceMs: firstNonSilentSample === null ? segmentAudioSamples / sampleRate * 1000 : firstNonSilentSample / sampleRate * 1000,
        trailingSilenceMs: lastNonSilentSample === null ? segmentAudioSamples / sampleRate * 1000 : (segmentAudioSamples - lastNonSilentSample - 1) / sampleRate * 1000,
      });
      reader.releaseLock();
    }
    const generationElapsedMs = performance.now() - requestStartedAt;
    if (!finishEachSegment) node.port.postMessage({ type: "finish", turnId: scenarioId });

    const expectedDrained = finishEachSegment ? segments.length : 1;
    const audioDurationMs = totalAudioSamples / sampleRate * 1000;
    const playbackStartedAt = events.find((event) => event.type === "started")?.atMs ?? performance.now();
    const playbackElapsedMs = Math.max(0, performance.now() - playbackStartedAt);
    const drainDeadline = performance.now() + Math.max(15_000, audioDurationMs - playbackElapsedMs + 5_000);
    while (events.filter((event) => event.type === "drained").length < expectedDrained && performance.now() < drainDeadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    window.clearInterval(monitor);
    const starts = events.filter((event) => event.type === "started");
    const drains = events.filter((event) => event.type === "drained");
    const underruns = events.filter((event) => event.type === "underrun-start");
    const underrunEnds = events.filter((event) => event.type === "underrun-end");
    const restartSilenceMs = [];
    for (const drained of drains) {
      const nextStarted = starts.find((event) => event.atMs > drained.atMs);
      if (nextStarted) restartSilenceMs.push(nextStarted.atMs - drained.atMs);
    }
    const segmentBoundaryGapsMs = events.filter((event) => event.type === "segment-boundary").map((event) => event.gapMs ?? 0);
    const pcmBoundarySilenceMs = segmentMetrics.slice(0, -1).map((segment, index) =>
      segment.trailingSilenceMs + segmentMetrics[index + 1].leadingSilenceMs,
    );
    const sentenceSilenceMs = pcmBoundarySilenceMs.map((pcmSilence, index) =>
      pcmSilence + (segmentBoundaryGapsMs[index] ?? 0) + (restartSilenceMs[index] ?? 0),
    );
    const rmsValues = events.filter((event) => event.type === "buffer" && typeof event.outputRms === "number").map((event) => event.outputRms);
    const result = {
      scenarioId,
      finishEachSegment,
      segmentCount: segments.length,
      model: "real local Qwen3-TTS service",
      sampleRate,
      elapsedMs: generationElapsedMs,
      wallThroughDrainMs: performance.now() - requestStartedAt,
      audioDurationMs,
      rtf: generationElapsedMs / audioDurationMs,
      firstAudioMs,
      firstAudibleMs: starts[0] ? starts[0].atMs - requestStartedAt : null,
      segmentMetrics,
      segmentBoundaryGapsMs,
      pcmBoundarySilenceMs,
      sentenceSilenceMs,
      workletStartCount: starts.length,
      workletDrainCount: drains.length,
      underrunCount: underruns.length,
      underrunSilenceMs: underrunEnds.reduce((total, event) => total + (event.durationMs ?? 0), 0),
      restartSilenceMs,
      totalInterSentenceSilenceMs: sentenceSilenceMs.reduce((total, value) => total + value, 0),
      nonSilentWorkletFrames: waveformFrames,
      nonSilentAnalyserFrames: nonSilentFrames,
      maxWorkletOutputRms: rmsValues.length ? Math.max(...rmsValues) : 0,
      events: events.filter((event) => ["started", "drained", "underrun-start", "underrun-end", "segment-boundary", "turn-mismatch"].includes(event.type)),
      allSegmentsCompleted: doneCount === segments.length,
    };
    await window.recordVoicePcm({ scenarioId, pcm16Chunks, sampleRate });
    await context.close();
    return result;
  }, { scenarioId, segments, finishEachSegment, token, sampleRate, prerollSeconds, characterId, emotion });

  console.log("MODEL", JSON.stringify({ model: status.model, speaker: status.speaker, state: status.state }));
  const before = await run("real-before-per-segment-finish", beforeSegments, true);
  console.log("BEFORE", JSON.stringify(summarize(before)));
  const after = await run("real-after-turn-finish", beforeSegments, false);
  console.log("AFTER", JSON.stringify(summarize(after)));
  assert.equal(before.allSegmentsCompleted, true);
  assert.equal(after.allSegmentsCompleted, true);
  assert.ok(after.segmentMetrics.every((segment) => segment.firstChunkElapsedMs !== null && segment.averageChunkIntervalMs !== null), "real TTS chunks must carry elapsed timestamps");
  assert.equal(after.workletDrainCount, 1, "the fixed protocol should finish and drain exactly once per turn");
  assert.equal(after.workletStartCount, 1, "the fixed protocol should preserve one continuous worklet playback start");
  assert.ok(after.nonSilentAnalyserFrames > 0, "the real AudioWorklet output must reach the playback analyser");

  const queuedBatchSegments = batchQueuedSentences(beforeSegments);
  console.log("QUEUED_BATCH_PLAN", JSON.stringify({ sourceSentences: beforeSegments.length, ttsRequests: queuedBatchSegments.length, requestTextLengths: queuedBatchSegments.map((text) => text.length), maxTextLength: 180 }));
  const queuedBatch = await run("real-after-queued-batch", queuedBatchSegments, false);
  assert.equal(queuedBatch.allSegmentsCompleted, true);
  assert.equal(queuedBatch.workletDrainCount, 1, "coalesced follow-up sentences should still finish the turn once");
  assert.equal(queuedBatch.workletStartCount, 1, "coalesced follow-up sentences should preserve continuous playback");
  console.log("QUEUED_BATCH", JSON.stringify(summarize(queuedBatch)));

  const single = await run("real-single-sentence", ["你好，今天我们一起慢慢整理思路，无论遇到什么问题都可以一步一步来。"], false);
  const singleRecording = recordings.get("real-single-sentence");
  const multiRecording = recordings.get("real-after-turn-finish");
  assert.ok(singleRecording && multiRecording, "single-sentence and full-stream PCM must be captured from the real model");
  assertRecordingDuration(singleRecording, single.audioDurationMs, "single-sentence");
  assertRecordingDuration(multiRecording, after.audioDurationMs, "multi-sentence");
  const { writeFileSync } = await import("node:fs");
  const singleWavPath = "/tmp/whalepartner-real-single-sentence.wav";
  const multiWavPath = "/tmp/whalepartner-real-multi-sentence.wav";
  writeFileSync(singleWavPath, createWav(Buffer.concat(singleRecording.pcm), singleRecording.sampleRate));
  writeFileSync(multiWavPath, createWav(Buffer.concat(multiRecording.pcm), multiRecording.sampleRate));
  console.log("SINGLE_SENTENCE", JSON.stringify({ ...summarize(single), wav: singleWavPath }));
  console.log("CONCATENATED_STREAM", JSON.stringify({ ...summarize(after), wav: multiWavPath }));

  const longRun = await run("real-sixty-second-chinese", longSpeechSegments, false);
  const longRecording = recordings.get("real-sixty-second-chinese");
  assert.ok(longRecording, "the long real model stream should produce a WAV recording");
  const measuredLongDurationMs = assertRecordingDuration(longRecording, longRun.audioDurationMs, "sixty-second");
  const longPcm = Buffer.concat(longRecording.pcm);
  const longDurationMs = longPcm.length / 2 / longRecording.sampleRate * 1000;
  const longWavPath = "/tmp/whalepartner-real-60s-continuous.wav";
  writeFileSync(longWavPath, createWav(longPcm, longRecording.sampleRate));
  console.log("SIXTY_SECOND", JSON.stringify({ ...summarize(longRun), concatenatedWav: longWavPath, actualWavDurationMs: longDurationMs, recordedPcmDurationMs: measuredLongDurationMs }));
  assert.ok(longDurationMs >= 60_000, "the concatenated real-model WAV must contain at least 60 seconds of Chinese speech");
  assert.equal(longRun.workletDrainCount, 1, "a sixty-second reply must drain only once at turn completion");

  const queuedLongSegments = batchQueuedSentences(longSpeechSegments);
  console.log("SIXTY_SECOND_QUEUED_BATCH_PLAN", JSON.stringify({ sourceSentences: longSpeechSegments.length, ttsRequests: queuedLongSegments.length, requestTextLengths: queuedLongSegments.map((text) => text.length), maxTextLength: 180 }));
  const queuedLongRun = await run("real-sixty-second-chinese-queued-batches", queuedLongSegments, false);
  const queuedLongRecording = recordings.get("real-sixty-second-chinese-queued-batches");
  assert.ok(queuedLongRecording, "the queued 60-second real-model stream should produce a WAV recording");
  const measuredQueuedLongDurationMs = assertRecordingDuration(queuedLongRecording, queuedLongRun.audioDurationMs, "sixty-second-queued-batches");
  const queuedLongPcm = Buffer.concat(queuedLongRecording.pcm);
  const queuedLongDurationMs = queuedLongPcm.length / 2 / queuedLongRecording.sampleRate * 1000;
  const queuedLongWavPath = "/tmp/whalepartner-real-60s-queued-batches.wav";
  writeFileSync(queuedLongWavPath, createWav(queuedLongPcm, queuedLongRecording.sampleRate));
  console.log("SIXTY_SECOND_QUEUED_BATCH", JSON.stringify({ ...summarize(queuedLongRun), concatenatedWav: queuedLongWavPath, actualWavDurationMs: queuedLongDurationMs, recordedPcmDurationMs: measuredQueuedLongDurationMs }));
  assert.ok(queuedLongDurationMs >= 60_000, "the batched real-model WAV must contain at least 60 seconds of Chinese speech");
  assert.equal(queuedLongRun.workletDrainCount, 1, "the batched sixty-second reply must drain only once at turn completion");

  const interruption = await page.evaluate(async ({ token, sampleRate, prerollSeconds, characterId, emotion }) => {
    const context = new AudioContext({ latencyHint: "interactive", sampleRate });
    await context.resume();
    await context.audioWorklet.addModule("/src/components/chat/pcm-playback-worklet.ts");
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(context.destination);
    const node = new AudioWorkletNode(context, "whale-pcm-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.connect(analyser);
    const events = [];
    node.port.onmessage = ({ data }) => events.push({ ...data, atMs: performance.now() });
    node.port.postMessage({ type: "configure", prerollSamples: Math.ceil(sampleRate * prerollSeconds) });
    const oldTurnId = "real-interrupted-turn";
    const nextTurnId = "real-rapid-next-turn";
    const oldController = new AbortController();
    const oldStartedAt = performance.now();
    const oldResponse = await fetch("/api/voice/tts/stream", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, token ? { authorization: "Bearer " + token } : {}),
      body: JSON.stringify({
        text: "这一轮回答会在播放途中被用户打断。系统必须马上停止旧声音、取消剩余合成，并清除旧轮次的音频队列。随后用户立即开始新的问题，新的回答只能使用新的轮次编号，不能混入上一轮的语音内容。为了覆盖取消时仍有较长文本待生成的情况，我们继续增加一些自然的说明内容，确保服务端还在生成时就发生打断。",
        turnId: oldTurnId,
        segmentIndex: 0,
        characterId,
        emotion,
      }),
      signal: oldController.signal,
    });
    if (!oldResponse.ok || !oldResponse.body) throw new Error("old turn request failed: HTTP " + oldResponse.status);
    const oldReader = oldResponse.body.getReader();
    const oldDecoder = new TextDecoder();
    let oldCarry = "";
    let oldAudioChunks = 0;
    let interruptedAt = null;
    while (true) {
      const result = await oldReader.read();
      oldCarry += oldDecoder.decode(result.value, { stream: !result.done });
      const lines = oldCarry.split("\n");
      oldCarry = lines.pop() ?? "";
      let shouldInterrupt = false;
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === "error") throw new Error(message.message || "old turn failed");
        if (message.type === "audio") {
          if (message.turnId !== oldTurnId) throw new Error("old turn emitted a mismatched turn ID");
          const pcm = atob(message.pcm16);
          const samples = new Float32Array(Math.floor(pcm.length / 2));
          for (let index = 0; index < samples.length; index += 1) {
            const value = pcm.charCodeAt(index * 2) | (pcm.charCodeAt(index * 2 + 1) << 8);
            samples[index] = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
          }
          node.port.postMessage({ type: "push", samples, turnId: oldTurnId, segmentIndex: 0, chunkIndex: oldAudioChunks }, [samples.buffer]);
          oldAudioChunks += 1;
          shouldInterrupt = true;
          break;
        }
      }
      if (shouldInterrupt) {
        interruptedAt = performance.now();
        oldController.abort();
        node.port.postMessage({ type: "stop", reason: "vad-user-speech-during-playback" });
        break;
      }
      if (result.done) break;
    }
    try { await oldReader.cancel(); } catch {}
    oldReader.releaseLock();
    if (interruptedAt === null) throw new Error("the real old turn produced no audio to interrupt");

    const nextStartedAt = performance.now();
    const nextResponse = await fetch("/api/voice/tts/stream", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, token ? { authorization: "Bearer " + token } : {}),
      body: JSON.stringify({
        text: "新的一轮已经开始，我们从这里继续。",
        turnId: nextTurnId,
        segmentIndex: 0,
        characterId,
        emotion,
      }),
    });
    if (!nextResponse.ok || !nextResponse.body) throw new Error("next turn request failed: HTTP " + nextResponse.status);
    const nextReader = nextResponse.body.getReader();
    const nextDecoder = new TextDecoder();
    let nextCarry = "";
    let nextAudioChunks = 0;
    let nextDone = false;
    const pushNextLines = (text) => {
      const lines = text.split("\n");
      nextCarry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === "error") throw new Error(message.message || "next turn failed");
        if (message.type === "audio") {
          if (message.turnId !== nextTurnId) throw new Error("old audio leaked into the rapid next turn");
          const pcm = atob(message.pcm16);
          const samples = new Float32Array(Math.floor(pcm.length / 2));
          for (let index = 0; index < samples.length; index += 1) {
            const value = pcm.charCodeAt(index * 2) | (pcm.charCodeAt(index * 2 + 1) << 8);
            samples[index] = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
          }
          node.port.postMessage({ type: "push", samples, turnId: nextTurnId, segmentIndex: 0, chunkIndex: nextAudioChunks }, [samples.buffer]);
          nextAudioChunks += 1;
        } else if (message.type === "done") {
          nextDone = true;
          node.port.postMessage({ type: "finish", turnId: nextTurnId });
        }
      }
    };
    while (true) {
      const result = await nextReader.read();
      pushNextLines(nextCarry + nextDecoder.decode(result.value, { stream: !result.done }));
      if (result.done) break;
    }
    pushNextLines(nextCarry + nextDecoder.decode());
    nextReader.releaseLock();
    if (!nextDone || nextAudioChunks === 0) throw new Error("the next real turn did not complete with audio");
    const drainDeadline = performance.now() + 15_000;
    while (!events.some((event) => event.type === "drained" && event.turnId === nextTurnId) && performance.now() < drainDeadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    const mismatch = events.find((event) => event.type === "turn-mismatch");
    if (mismatch) throw new Error("AudioWorklet rejected a turn ID: " + JSON.stringify(mismatch));
    const result = {
      oldTurnId,
      nextTurnId,
      oldAudioChunks,
      cancelledAfterMs: interruptedAt - oldStartedAt,
      nextFirstAudibleMs: events.find((event) => event.type === "started" && event.turnId === nextTurnId)?.atMs - nextStartedAt ?? null,
      nextAudioChunks,
      stopReason: events.find((event) => event.type === "stopped")?.reason,
      nextDrained: events.some((event) => event.type === "drained" && event.turnId === nextTurnId),
      turnMismatchCount: events.filter((event) => event.type === "turn-mismatch").length,
    };
    await context.close();
    return result;
  }, { token, sampleRate, prerollSeconds, characterId, emotion });
  assert.ok(interruption.oldAudioChunks > 0, "the old real turn must be producing audio when interrupted");
  assert.equal(interruption.stopReason, "vad-user-speech-during-playback");
  assert.equal(interruption.nextDrained, true, "the rapid next real turn must drain independently");
  assert.equal(interruption.turnMismatchCount, 0, "old-turn PCM must not enter the next AudioWorklet turn");
  console.log("INTERRUPT_AND_RAPID_NEXT_TURN", JSON.stringify(interruption));
} finally {
  if (browser) await browser.close();
  await server.close();
}
