import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { loadConfig } from "../src/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import type { AsrService, AsrStatus, AsrUpdate } from "../src/voice/asr.ts";
import { COSYVOICE_MODEL_FILES, cosyVoiceModelIsReady, createCosyVoiceTtsService, type TtsService, type TtsStatus, type TtsStreamContext } from "../src/voice/tts.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

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
    await unlink(join(modelDirectory, "CosyVoice-BlankEN/tokenizer_config.json"));
    assert.equal(cosyVoiceModelIsReady(modelDirectory), false);
  } finally {
    await rm(modelDirectory, { recursive: true, force: true });
  }
});

test("CosyVoice waits for both the Big Fish reference audio and matching text", async (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("CosyVoice local TTS is supported on Apple Silicon macOS.");
    return;
  }
  const dataDirectory = await mkdtemp(join(tmpdir(), "whalepartner-cosyvoice-"));
  const referenceAudioPath = join(dataDirectory, "reference.wav");
  const tts = createCosyVoiceTtsService(dataDirectory, { referenceAudioPath });
  try {
    await writeFile(referenceAudioPath, "reference audio placeholder");
    assert.equal(tts.status().state, "waiting_reference");
    assert.match(tts.status().model, /CosyVoice3-0\.5B/);
    await tts.warm();
    assert.equal(tts.status().state, "waiting_reference");
    await assert.rejects(tts.stream("你好。", () => {}), /等待大肥鱼参考音频/);
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

    const ttsStatus = await (await fetch(`${base}/api/voice/tts/status`)).json() as TtsStatus;
    assert.equal(ttsStatus.state, "idle");
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

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try { resolve(JSON.parse(data.toString()) as Record<string, unknown>); }
      catch (error) { reject(error); }
    });
    socket.once("error", reject);
  });
}
