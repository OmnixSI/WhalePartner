import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, open, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import { test } from "node:test";
import WebSocket from "ws";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import type { AuthOptions } from "../src/hub/auth.ts";
import { attachVoiceWebSocket, handleVoiceRoute } from "../src/routes/voice.ts";
import { createXAsrAsrService, OFFLINE_ARCHIVE, OFFLINE_MODEL_FILES, STREAMING_ARCHIVE, STREAMING_MODEL_FILES, type AsrService, type AsrStatus, type AsrUpdate } from "../src/voice/asr.ts";
import { COSYVOICE_MODEL_FILES, COSYVOICE_RUNTIME_FILES, cosyVoiceModelIsReady, cosyVoiceNativeRuntimeIsReady, createCosyVoiceTtsService, TTS_MAX_TEXT_LENGTH, ttsRequestTimeoutMs, type TtsService, type TtsStatus, type TtsStreamContext } from "../src/voice/tts.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";
import { DeviceRegistry } from "../src/hub/devices.ts";

const provider: ChatProvider = {
  id: "fixture",
  model: "fixture-model",
  async *stream() { yield { text: "好" }; },
};

function fakeAsr(): AsrService & { received: Buffer[]; setUpdate(update: AsrUpdate): void } {
  let current: AsrStatus = { state: "idle", progress: null, message: "待准备", model: "X-ASR fixture", offlineRefinement: "idle" };
  const received: Buffer[] = [];
  let next: AsrUpdate = { text: "", final: false };
  return {
    received,
    status: () => current,
    async warm() { current = { ...current, state: "ready", progress: 100, message: "已就绪", offlineRefinement: "ready" }; },
    async prewarmIfInstalled() {},
    async rebuild() { await this.warm(); },
    async createStream() {
      await this.warm();
      return {
        async acceptPcm(pcm) { received.push(pcm); const result = next; next = { text: "", final: false }; return result; },
        async finish() { return { text: next.text, final: true }; },
        async close() {},
      };
    },
    setUpdate(update: AsrUpdate) { next = update; },
  };
}

function fakeTts(): TtsService & { received: Array<{ text: string; context?: TtsStreamContext }> } {
  const received: Array<{ text: string; context?: TtsStreamContext }> = [];
  let current: TtsStatus = { state: "idle", progress: null, message: "待准备", model: "TTS fixture", speaker: "Fixture" };
  return {
    received,
    status: () => current,
    async warm() { current = { ...current, state: "ready", progress: 100, message: "已就绪" }; },
    async prewarmIfInstalled() {},
    async rebuild() { await this.warm(); },
    async stream(text, onChunk, _signal, context) {
      received.push({ text, context });
      onChunk({ sampleRate: 24_000, pcm16: "AAABAA==" });
    },
  };
}

test("CosyVoice model readiness requires every inference and tokenizer file", async () => {
  const modelDirectory = await mkdtemp(join(tmpdir(), "whalepartner-cosyvoice-model-"));
  try {
    for (const file of COSYVOICE_MODEL_FILES) {
      const path = join(modelDirectory, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "fixture");
    }
    assert.equal(cosyVoiceModelIsReady(modelDirectory), true);
    await unlink(join(modelDirectory, "speech_tokenizer/model.safetensors"));
    assert.equal(cosyVoiceModelIsReady(modelDirectory), false);
  } finally {
    await rm(modelDirectory, { recursive: true, force: true });
  }
});

test("CosyVoice native runtime readiness matches the current macOS deployment target", async () => {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "whalepartner-cosyvoice-runtime-"));
  try {
    for (const file of COSYVOICE_RUNTIME_FILES) {
      const path = join(runtimeDirectory, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file === "deployment-target" ? "15.0\n" : "fixture");
    }
    assert.equal(cosyVoiceNativeRuntimeIsReady(runtimeDirectory, "15.0"), true);
    await writeFile(join(runtimeDirectory, "deployment-target"), "26.0\n");
    assert.equal(cosyVoiceNativeRuntimeIsReady(runtimeDirectory, "15.0"), false);
  } finally {
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
});

test("CosyVoice does not fall back to the previous raw reference instead of the imported profile", async (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("CosyVoice local TTS is supported on Apple Silicon macOS.");
    return;
  }
  const dataDirectory = await mkdtemp(join(tmpdir(), "whalepartner-cosyvoice-"));
  const voiceDirectory = join(dataDirectory, "voices", "big-fish");
  const tts = createCosyVoiceTtsService(dataDirectory);
  try {
    await mkdir(voiceDirectory, { recursive: true });
    await writeFile(join(voiceDirectory, "cosyvoice3-reference.wav"), "previous reference audio");
    await writeFile(join(voiceDirectory, "cosyvoice3-reference.txt"), "previous reference text");
    assert.equal(tts.status().state, "waiting_reference");
    assert.match(tts.status().model, /CosyVoice3-0\.5B/);
    await tts.warm();
    assert.equal(tts.status().state, "waiting_reference");
    await assert.rejects(tts.stream("你好。", () => {}), /等待导入大肥鱼的 CosyVoice 音色配置/);
  } finally {
    await tts.close?.();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("ASR rebuild removes only the speech runtime and model caches", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "whalepartner-asr-rebuild-"));
  const modelRoot = join(dataDirectory, "models");
  const streaming = join(modelRoot, "sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05");
  const offline = join(modelRoot, "sherpa-onnx-x-asr-zipformer-transducer-zh-en-punct-int8-2026-06-03");
  const runtime = join(dataDirectory, "runtimes", "asr-sherpa");
  const pythonPath = join(dataDirectory, "python");
  const setupScriptPath = join(dataDirectory, "setup-xasr.sh");
  const unrelated = [
    join(dataDirectory, "models", "tts", "keep.txt"),
    join(dataDirectory, "models", "memory", "keep.txt"),
    join(dataDirectory, "runtimes", "tts-cosyvoice3-mlx-native", "keep.txt"),
    join(dataDirectory, "voices", "big-fish", "keep.txt"),
  ];
  const service = createXAsrAsrService(dataDirectory, { pythonPath, setupScriptPath });
  try {
    for (const directory of [streaming, offline, runtime, ...unrelated.map(dirname)]) await mkdir(directory, { recursive: true });
    for (const file of unrelated) await writeFile(file, "keep");
    await mkdir(`${streaming}.install-interrupted`, { recursive: true });
    await writeFile(pythonPath, "#!/bin/sh\nexit 1\n");
    await writeFile(setupScriptPath, "#!/bin/sh\nexit 1\n");
    await chmod(pythonPath, 0o755);
    await chmod(setupScriptPath, 0o755);

    await assert.rejects(service.rebuild());

    for (const path of [streaming, offline, runtime, `${streaming}.install-interrupted`]) await assert.rejects(access(path));
    for (const path of unrelated) await access(path);
  } finally {
    await service.close?.();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("CosyVoice rebuild replaces only its environment and preserves the voice profile", async (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("CosyVoice local TTS is supported on Apple Silicon macOS.");
    return;
  }
  const dataDirectory = await mkdtemp(join(tmpdir(), "whalepartner-tts-rebuild-"));
  const modelDirectory = join(dataDirectory, "models", "tts", "cosyvoice3-mlx-fp16");
  const runtimeDirectory = join(dataDirectory, "runtimes", "tts-cosyvoice3-mlx-native");
  const voiceFile = join(dataDirectory, "voices", "big-fish", "keep.txt");
  const asrFile = join(dataDirectory, "models", "sherpa-onnx-x-asr-keep.txt");
  const tts = createCosyVoiceTtsService(dataDirectory);
  try {
    for (const path of [modelDirectory, runtimeDirectory, dirname(voiceFile), dirname(asrFile)]) await mkdir(path, { recursive: true });
    await writeFile(join(modelDirectory, "old-model"), "old");
    await writeFile(join(runtimeDirectory, "old-runtime"), "old");
    await writeFile(voiceFile, "preserve");
    await writeFile(asrFile, "preserve");

    await tts.rebuild();

    await assert.rejects(access(modelDirectory));
    await assert.rejects(access(runtimeDirectory));
    await access(voiceFile);
    await access(asrFile);
    assert.equal(tts.status().state, "waiting_reference");
  } finally {
    await tts.close?.();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("CosyVoice uses the bundled default voice without downloading an uninstalled model on startup", async (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("CosyVoice local TTS is supported on Apple Silicon macOS.");
    return;
  }
  const dataDirectory = await mkdtemp(join(tmpdir(), "whalepartner-tts-bundled-voice-"));
  const bundledVoiceProfileDirectory = join(import.meta.dirname, "../src/voice/assets/keli_voice");
  const tts = createCosyVoiceTtsService(dataDirectory, { bundledVoiceProfileDirectory });
  try {
    assert.notEqual(tts.status().state, "waiting_reference");
    await tts.prewarmIfInstalled();
    assert.equal(tts.status().state, "idle");
    await assert.rejects(access(join(dataDirectory, "models", "tts", "cosyvoice3-mlx-fp16")));
  } finally {
    await tts.close?.();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("voice routes stream X-ASR PCM and segmented TTS audio", async () => {
  const store = new ChatStore(":memory:");
  const asr = fakeAsr();
  const tts = fakeTts();
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store, asr, tts });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  let socket: WebSocket | null = null;
  try {
    const initial = await (await fetch(`${base}/api/voice/asr/status`)).json() as AsrStatus;
    assert.equal(initial.state, "idle");
    assert.match(initial.model, /X-ASR/);

    const prepared = await fetch(`${base}/api/voice/asr/warm`, { method: "POST" });
    assert.equal(prepared.status, 200);
    const preparedStatus = await prepared.json() as AsrStatus;
    assert.equal(preparedStatus.state, "ready");
    assert.equal(preparedStatus.offlineRefinement, "ready");

    const asrRebuilt = await fetch(`${base}/api/voice/asr/rebuild`, { method: "POST" });
    assert.equal(asrRebuilt.status, 200);
    assert.equal((await asrRebuilt.json() as AsrStatus).state, "ready");

    const ttsRebuilt = await fetch(`${base}/api/voice/tts/rebuild`, { method: "POST" });
    assert.equal(ttsRebuilt.status, 200);
    assert.equal((await ttsRebuilt.json() as TtsStatus).state, "ready");

    const ttsStatus = await (await fetch(`${base}/api/voice/tts/status`)).json() as TtsStatus;
    assert.equal(ttsStatus.state, "ready");
    const ttsResponse = await fetch(`${base}/api/voice/tts/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "你好，今天聊聊吧。", turnId: "voice-turn-1", segmentIndex: 2, characterId: "deepseek", emotion: "happy" }),
    });
    assert.equal(ttsResponse.status, 200);
    const ttsLines = (await ttsResponse.text()).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(ttsLines.map((line) => line.type), ["meta", "audio", "done"]);
    assert.ok(ttsLines.every((line) => line.turnId === "voice-turn-1"));
    assert.ok(ttsLines.every((line) => line.segmentIndex === 2));
    assert.equal(ttsLines[1].sampleRate, 24_000);
    assert.deepEqual(tts.received, [{
      text: "你好，今天聊聊吧。",
      context: { turnId: "voice-turn-1", segmentIndex: 2, characterId: "deepseek", emotion: "happy" },
    }]);
    const invalidTts = await fetch(`${base}/api/voice/tts/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "你好" }),
    });
    assert.equal(invalidTts.status, 400);

    socket = new WebSocket(base.replace("http:", "ws:") + "/api/voice/asr/stream");
    const opened = once(socket, "open");
    const ready = nextMessage(socket);
    await opened;
    assert.deepEqual(await ready, { type: "ready", model: "X-ASR fixture", offlineRefinement: "ready" });
    const frame = Buffer.alloc(3_200);
    socket.send(frame);

    asr.setUpdate({ text: "今天天气", final: false });
    const partial = nextMessage(socket);
    socket.send(frame);
    assert.deepEqual(await partial, { type: "partial", text: "今天天气" });

    asr.setUpdate({ text: "今天天气不错。", final: true });
    const final = nextMessage(socket);
    socket.send(frame);
    assert.deepEqual(await final, { type: "final", text: "今天天气不错。" });
    assert.equal(asr.received.length, 3);
    assert.equal(asr.received[0].byteLength, 3_200);

    socket.close();
    await once(socket, "close");
    socket = null;
    const removedBatchRoute = await fetch(`${base}/api/voice/asr/transcribe`, { method: "POST" });
    assert.equal(removedBatchRoute.status, 404);
  } finally {
    socket?.terminate();
    server.closeVoiceConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("X-ASR WebSocket honors the hub token before opening a microphone stream", async () => {
  const store = new ChatStore(":memory:");
  const asr = fakeAsr();
  const tts = fakeTts();
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store, asr, tts, auth: { localToken: "voice-token" } });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const deniedStatus = await fetch(`${base}/api/voice/tts/status`);
    assert.equal(deniedStatus.status, 401);
    const acceptedStatus = await fetch(`${base}/api/voice/tts/status`, { headers: { authorization: "Bearer voice-token" } });
    assert.equal(acceptedStatus.status, 200);

    const rejected = new WebSocket(base.replace("http:", "ws:") + "/api/voice/asr/stream");
    rejected.on("error", () => {});
    const error = await once(rejected, "unexpected-response");
    assert.equal((error[1] as { statusCode?: number }).statusCode, 401);
    rejected.close();

    const accepted = new WebSocket(`${base.replace("http:", "ws:")}/api/voice/asr/stream?token=voice-token`);
    const readyMessage = nextMessage(accepted);
    await once(accepted, "open");
    const ready = await readyMessage;
    assert.deepEqual(ready, { type: "ready", model: "X-ASR fixture", offlineRefinement: "ready" });
    accepted.close();
    await once(accepted, "close");
  } finally {
    server.closeVoiceConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("撤销设备会断开它的语音 WebSocket，重连返回 401", async () => {
  const store = new ChatStore(":memory:");
  const devices = new DeviceRegistry();
  const { code } = devices.createPairingCode();
  const paired = devices.redeem(code, "手机");
  assert.equal(paired.ok, true);
  if (!paired.ok) return;
  const server = createApiServer({
    config: loadConfig({}),
    provider: new FallbackChatProvider([provider]),
    store,
    asr: fakeAsr(),
    tts: fakeTts(),
    auth: { devices },
  });
  const base = await listen(server);
  try {
    const url = `${base.replace("http:", "ws:")}/api/voice/asr/stream?token=${paired.token}`;
    const socket = new WebSocket(url);
    const ready = nextMessage(socket);
    await once(socket, "open");
    await ready;

    const closed = once(socket, "close");
    assert.equal((await fetch(`${base}/api/devices/${paired.device.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${paired.token}` },
    })).status, 200);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        closed,
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("撤销设备后语音连接没有断开。")), 1_000); }),
      ]);
    } finally {
      clearTimeout(timer);
    }

    const rejected = new WebSocket(url);
    rejected.on("error", () => {});
    const error = await once(rejected, "unexpected-response");
    assert.equal((error[1] as { statusCode?: number }).statusCode, 401);
    rejected.close();
  } finally {
    server.closeVoiceConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test("CosyVoice synthesis timeout grows with the text length and keeps the 120 s floor", () => {
  assert.equal(ttsRequestTimeoutMs(40), 120_000);
  assert.ok(ttsRequestTimeoutMs(600) > 120_000);
  assert.ok(ttsRequestTimeoutMs(TTS_MAX_TEXT_LENGTH) > ttsRequestTimeoutMs(600));
});

test("TTS stream errors keep the segment index so the client shows the real message", async () => {
  const asr = fakeAsr();
  const tts: TtsService = { ...fakeTts(), async stream() { throw new Error("CosyVoice 原生服务返回错误（500）。"); } };
  const server = createServer((request, response) => {
    void handleVoiceRoute(asr, tts, request, response, new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  });
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/api/voice/tts/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "你好。", turnId: "voice-turn-error", segmentIndex: 4 }),
    });
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(lines.at(-1), { type: "error", message: "CosyVoice 原生服务返回错误（500）。", turnId: "voice-turn-error", segmentIndex: 4 });
  } finally {
    await closeServer(server);
  }
});

test("voice WebSocket rejections destroy the socket and survive a failing token check", async () => {
  const server = createServer((_request, response) => { response.writeHead(404).end(); });
  // 设备库读不了时 authorize 会抛错；upgrade 回调里抛出的异常会直接带崩整个 API 进程。
  const auth = { localToken: "voice-token", devices: { verify() { throw new Error("设备库已关闭。"); } } } as unknown as AuthOptions;
  const closeVoice = attachVoiceWebSocket(server, fakeAsr(), auth);
  const upgraded: Duplex[] = [];
  server.on("upgrade", (_request, socket: Duplex) => { upgraded.push(socket); });
  await listen(server);
  const { port } = server.address() as AddressInfo;
  const clients: Socket[] = [];
  try {
    const missing = await rawUpgrade(port, "/api/voice/other");
    clients.push(missing.client);
    assert.match(missing.response, /^HTTP\/1\.1 404 Not Found\r\n/);
    const failing = await rawUpgrade(port, "/api/voice/asr/stream", { authorization: "Bearer device-token" });
    clients.push(failing.client);
    assert.match(failing.response, /^HTTP\/1\.1 500 Internal Server Error\r\n/);
    assert.equal(upgraded.length, 2);
    // 客户端一直不关自己那一半，服务端也要在写完响应后销毁 socket，不留半开连接。
    for (const socket of upgraded) {
      assert.ok(socket.listenerCount("error") > 0);
      if (!socket.destroyed) await once(socket, "close", { signal: AbortSignal.timeout(2_000) });
      assert.equal(socket.destroyed, true);
    }
  } finally {
    for (const client of clients) client.destroy();
    closeVoice();
    await closeServer(server);
  }
});

test("voice WebSocket closes an X-ASR stream that finishes starting after the client left", async () => {
  let finishStarting: () => void = () => {};
  const starting = new Promise<void>((resolve) => { finishStarting = resolve; });
  let created = 0;
  let closed = 0;
  const asr: AsrService = {
    ...fakeAsr(),
    async createStream() {
      created += 1;
      await starting;
      return {
        async acceptPcm() { return { text: "", final: false }; },
        async finish() { return { text: "", final: true }; },
        async close() { closed += 1; },
      };
    },
  };
  const server = createServer();
  const closeVoice = attachVoiceWebSocket(server, asr, {});
  const base = await listen(server);
  try {
    const socket = new WebSocket(`${base.replace("http:", "ws:")}/api/voice/asr/stream`);
    await once(socket, "open");
    assert.equal(created, 1);
    socket.close();
    await once(socket, "close");
    finishStarting();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, 1);
  } finally {
    closeVoice();
    await closeServer(server);
  }
});

test("X-ASR model install clears temporary directories left by an interrupted download", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "whalepartner-asr-partial-"));
  const modelRoot = join(dataDirectory, "models");
  const interrupted = join(modelRoot, `${STREAMING_ARCHIVE}.install-interrupted`);
  const workerPath = join(dataDirectory, "xasr-worker");
  const previousFetch = globalThis.fetch;
  const service = createXAsrAsrService(dataDirectory, { workerPath });
  try {
    await mkdir(interrupted, { recursive: true });
    await writeFile(join(interrupted, "model.tar.bz2"), "partial download");
    await writeFile(workerPath, "");
    // 不连外网：下载直接返回 404。
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(service.warm(), /HTTP 404/);
    assert.deepEqual(await readdir(modelRoot), []);
  } finally {
    globalThis.fetch = previousFetch;
    await service.close?.();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("X-ASR stops a worker that never became fully ready so a later warm-up starts a fresh one", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "whalepartner-asr-retry-"));
  const workerPath = join(dataDirectory, "xasr-worker");
  const spawnLog = join(dataDirectory, "spawns.log");
  const service = createXAsrAsrService(dataDirectory, { workerPath });
  try {
    for (const [archive, files] of [[STREAMING_ARCHIVE, STREAMING_MODEL_FILES], [OFFLINE_ARCHIVE, OFFLINE_MODEL_FILES]] as const) {
      const directory = join(dataDirectory, "models", archive);
      await mkdir(directory, { recursive: true });
      // 稀疏文件：大小和真实模型一致，不占磁盘也不用下载。
      for (const file of files) {
        const handle = await open(join(directory, file.name), "w");
        await handle.truncate(file.size);
        await handle.close();
      }
      await writeFile(join(directory, "bpe.vocab"), "x".repeat(10_001));
    }
    // 第 1 次：模型载入报错但进程不退；第 2 次：就绪但整句精修没载入；第 3 次：正常就绪。
    await writeFile(workerPath, `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(spawnLog)}, process.pid + "\\n");
const attempt = fs.readFileSync(${JSON.stringify(spawnLog)}, "utf8").trim().split("\\n").length;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
if (attempt === 1) send({ type: "error", message: "流式模型载入失败" });
else send({ type: "ready", refinementReady: attempt > 2 });
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.action === "shutdown") process.exit(0);
  send({ type: "reply", requestId: request.requestId, ok: true });
});
`);
    await chmod(workerPath, 0o755);

    await assert.rejects(service.warm(), /流式模型载入失败/);
    await assert.rejects(service.warm(), /整句精修模型载入失败/);
    await service.warm();
    assert.equal(service.status().state, "ready");
    assert.equal(service.status().offlineRefinement, "ready");

    const pids = (await readFile(spawnLog, "utf8")).trim().split("\n").map(Number);
    assert.equal(pids.length, 3);
    for (const pid of pids.slice(0, 2)) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    await service.close?.();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** 发一个裸的 WebSocket 升级请求；客户端保持半开，读到服务端关闭写端为止。 */
async function rawUpgrade(port: number, path: string, headers: Record<string, string> = {}): Promise<{ client: Socket; response: string }> {
  const client = connect({ port, host: "127.0.0.1", allowHalfOpen: true });
  let response = "";
  client.on("data", (chunk: Buffer) => { response += chunk.toString("utf8"); });
  await once(client, "connect");
  client.write([
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "",
    "",
  ].join("\r\n"));
  try {
    await once(client, "end", { signal: AbortSignal.timeout(2_000) });
  } catch (error) {
    client.destroy();
    throw error;
  }
  return { client, response };
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try { resolve(JSON.parse(data.toString()) as Record<string, unknown>); }
      catch (error) { reject(error); }
    });
    socket.once("error", reject);
  });
}
