import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { lstat, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Emotion } from "../chat/emotion.ts";
import { SetupProcessRunner } from "./setup-process.ts";

const MODEL_ID = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512";
const SAMPLE_RATE = 24_000;
/** Longest text a single /api/voice/tts/stream request may synthesize. */
export const TTS_MAX_TEXT_LENGTH = 1200;
const MIN_REQUEST_TIMEOUT_MS = 120_000;
// Chinese speech runs at roughly 4 characters per second (~250 ms of audio per character). Allowing 500 ms per
// character tolerates synthesis twice as slow as real time, so long replies still finish on slower Macs, while
// short segments keep the 120 s floor. The longest accepted text (1200 characters) gets 10 minutes.
const REQUEST_TIMEOUT_PER_CHARACTER_MS = 500;

export function ttsRequestTimeoutMs(textLength: number): number {
  return Math.max(MIN_REQUEST_TIMEOUT_MS, textLength * REQUEST_TIMEOUT_PER_CHARACTER_MS);
}

export const TTS_MODEL = "CosyVoice3-0.5B · MLX";
export const TTS_VOICE_REFERENCE = "voices/big-fish/keli_voice/reference.wav";
export const TTS_VOICE_METADATA = "voices/big-fish/keli_voice/voice.json";
export const COSYVOICE_MODEL_FILES = [
  "config.json",
  "model.safetensors",
  "tokenizer.json",
  "tokenizer_config.json",
  "speech_tokenizer/config.json",
  "speech_tokenizer/model.safetensors",
] as const;
export const COSYVOICE_RUNTIME_FILES = [
  "bin/cosyvoice3_server",
  "bin/libmlx.dylib",
  "bin/mlx.metallib",
  "deployment-target",
] as const;

export function cosyVoiceModelIsReady(modelDirectory: string): boolean {
  return COSYVOICE_MODEL_FILES.every((file) => existsSync(join(modelDirectory, file)));
}

export function cosyVoiceNativeRuntimeIsReady(runtimeDirectory: string, deploymentTarget = macosDeploymentTarget()): boolean {
  if (!deploymentTarget) return false;
  if (!COSYVOICE_RUNTIME_FILES.every((file) => existsSync(join(runtimeDirectory, file)))) return false;
  try {
    return readFileSync(join(runtimeDirectory, "deployment-target"), "utf8").trim() === deploymentTarget;
  } catch {
    return false;
  }
}

export interface TtsStatus {
  state: "idle" | "waiting_reference" | "loading" | "ready" | "failed";
  progress: number | null;
  message: string;
  model: string;
  speaker: string;
}

export interface TtsAudioChunk {
  sampleRate: number;
  pcm16: string;
  chunkIndex?: number;
  elapsedMs?: number;
  audioDurationMs?: number;
}

export interface TtsStreamContext {
  turnId?: string;
  segmentIndex?: number;
  emotion?: Emotion;
  characterId?: string;
}

export interface TtsService {
  status(): TtsStatus;
  warm(): Promise<void>;
  prewarmIfInstalled(): Promise<void>;
  rebuild(): Promise<void>;
  stream(text: string, onChunk: (chunk: TtsAudioChunk) => void, signal?: AbortSignal, context?: TtsStreamContext): Promise<void>;
  close?(): Promise<void>;
}

export interface CosyVoiceTtsOptions {
  dataDirectory: string;
  serverPath?: string;
  runtimeSetupScriptPath?: string;
  modelSetupScriptPath?: string;
  voiceReferencePath?: string;
  voiceMetadataPath?: string;
  bundledVoiceProfileDirectory?: string;
}

interface VoiceProfile {
  referencePath: string;
  transcript: string;
}

export class CosyVoiceTtsService implements TtsService {
  readonly #options: CosyVoiceTtsOptions;
  readonly #runtimeDirectory: string;
  readonly #modelDirectory: string;
  readonly #serverPath: string;
  readonly #voiceReferencePath: string;
  readonly #voiceMetadataPath: string;
  readonly #supported: boolean;
  readonly #deploymentTarget: string | null;
  readonly #setupProcesses = new SetupProcessRunner();
  readonly #processExit = () => {
    this.#setupProcesses.killNow();
    this.#server?.kill();
  };
  readonly #activeRequests = new Set<AbortController>();
  #current: TtsStatus;
  #warmPromise: Promise<void> | null = null;
  #legacyCleanup: Promise<void> | null = null;
  #server: ChildProcess | null = null;
  #serverUrl: string | null = null;
  #serverLog = "";
  #voiceProfile: VoiceProfile | null = null;
  #closing = false;

  constructor(options: CosyVoiceTtsOptions) {
    this.#options = options;
    const dataDirectory = resolve(options.dataDirectory);
    this.#runtimeDirectory = join(dataDirectory, "runtimes", "tts-cosyvoice3-mlx-native");
    this.#modelDirectory = join(dataDirectory, "models", "tts", "cosyvoice3-mlx-fp16");
    this.#serverPath = options.serverPath ?? join(this.#runtimeDirectory, "bin", "cosyvoice3_server");
    const userVoiceMetadataPath = resolve(options.voiceMetadataPath ?? join(dataDirectory, TTS_VOICE_METADATA));
    const bundledMetadataPath = options.bundledVoiceProfileDirectory
      ? join(resolve(options.bundledVoiceProfileDirectory), "voice.json")
      : null;
    this.#voiceMetadataPath = existsSync(userVoiceMetadataPath) || !bundledMetadataPath
      ? userVoiceMetadataPath
      : bundledMetadataPath;
    this.#voiceReferencePath = resolve(options.voiceReferencePath ?? join(dirname(this.#voiceMetadataPath), "reference.wav"));
    this.#deploymentTarget = macosDeploymentTarget();
    this.#supported = process.platform === "darwin" && process.arch === "arm64" && this.#deploymentTarget !== null;
    const hasVoiceProfile = existsSync(this.#voiceReferencePath) && existsSync(this.#voiceMetadataPath);
    this.#current = {
      state: this.#supported ? (hasVoiceProfile ? "idle" : "waiting_reference") : "failed",
      progress: null,
      message: this.#supported
        ? (hasVoiceProfile ? "CosyVoice 环境尚未配置，请在设置中一键安装。" : "等待导入大肥鱼的 CosyVoice 音色配置。")
        : "本地语音合成需要 macOS 15 或更新版本的 Apple Silicon Mac。",
      model: TTS_MODEL,
      speaker: "大肥鱼预设音色",
    };
    process.once("exit", this.#processExit);
  }

  status(): TtsStatus {
    return { ...this.#current };
  }

  warm(): Promise<void> {
    if (!this.#supported) return Promise.reject(new Error(this.#current.message));
    if (!this.#hasVoiceProfile()) {
      this.#current = { ...this.#current, state: "waiting_reference", progress: null, message: "等待导入大肥鱼的 CosyVoice 音色配置。" };
      return Promise.resolve();
    }
    if (this.#server && this.#server.exitCode === null && this.#serverUrl) {
      this.#current = { ...this.#current, state: "ready", progress: 100, message: "CosyVoice MLX 本地语音已就绪。" };
      return Promise.resolve();
    }
    if (this.#warmPromise) return this.#warmPromise;
    this.#current = { ...this.#current, state: "loading", progress: null, message: "正在准备原生 MLX 语音模型。首次启动会构建运行时并下载模型。" };
    this.#warmPromise = this.#prepare().then(() => {
      this.#current = { ...this.#current, state: "ready", progress: 100, message: "CosyVoice MLX 本地语音已就绪。" };
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.#current = { ...this.#current, state: "failed", progress: null, message };
      throw error instanceof Error ? error : new Error(message);
    }).finally(() => {
      this.#warmPromise = null;
    });
    return this.#warmPromise;
  }

  async prewarmIfInstalled(): Promise<void> {
    if (!this.#supported || !this.#hasVoiceProfile()) return;
    if (!cosyVoiceNativeRuntimeIsReady(this.#runtimeDirectory, this.#deploymentTarget)
      || !cosyVoiceModelIsReady(this.#modelDirectory)) {
      this.#current = { ...this.#current, state: "idle", progress: null, message: "CosyVoice 环境尚未配置，请在设置中一键安装。" };
      return;
    }
    await this.warm();
  }

  async rebuild(): Promise<void> {
    if (!this.#supported) throw new Error(this.#current.message);
    if (this.#warmPromise) throw new Error("CosyVoice 正在安装或加载，完成后再重建。");
    if (this.#activeRequests.size > 0) throw new Error("语音生成正在进行，请结束语音后再重建环境。");
    // The rebuild deletes the directories a still-running setup script is writing to; end it first.
    this.#setupProcesses.kill();
    await this.#stopServer();
    const dataDirectory = resolve(this.#options.dataDirectory);
    const paths = [
      this.#runtimeDirectory,
      this.#modelDirectory,
      join(dataDirectory, "runtimes", ".cosyvoice3-native-previous"),
      join(dataDirectory, "runtimes", ".cosyvoice3-native-source"),
      join(dataDirectory, "runtimes", ".cosyvoice3-native-build"),
    ];
    await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
    await this.warm();
  }

  async stream(text: string, onChunk: (chunk: TtsAudioChunk) => void, signal?: AbortSignal, context?: TtsStreamContext): Promise<void> {
    if (signal?.aborted) throw abortError();
    await this.warm();
    if (signal?.aborted) throw abortError();
    if (this.#current.state !== "ready" || !this.#serverUrl || !this.#voiceProfile) throw new Error(this.#current.message);

    const startedAt = performance.now();
    const requestId = randomUUID();
    const controller = new AbortController();
    let timedOut = false;
    const abortRequest = () => controller.abort();
    signal?.addEventListener("abort", abortRequest, { once: true });
    this.#activeRequests.add(controller);
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ttsRequestTimeoutMs(text.length));

    console.info("[whalepartner:voice]", JSON.stringify({
      event: "tts-segment-start",
      requestId,
      turnId: context?.turnId,
      segmentIndex: context?.segmentIndex,
      characterId: context?.characterId,
      textLength: text.length,
      backend: "mlx-native-cpp",
      at: Date.now(),
    }));

    try {
      const response = await fetch(`${this.#serverUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL_ID,
          input: text,
          ref_audio: this.#voiceProfile.referencePath,
          ref_text: this.#voiceProfile.transcript,
          speed: 1.0,
          top_p: 0.8,
          top_k: 25,
          response_format: "pcm",
          stream: true,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(readNativeError(message) ?? `CosyVoice 原生服务返回错误（${response.status}）。`);
      }

      const pcm = Buffer.from(await response.arrayBuffer());
      if (pcm.length === 0 || pcm.length % 2 !== 0) throw new Error("CosyVoice 原生服务没有返回完整的 PCM16 音频。");
      const audioDurationMs = pcm.length / 2 / SAMPLE_RATE * 1000;
      const elapsedMs = performance.now() - startedAt;
      const chunkSize = SAMPLE_RATE * 2 * 0.35;
      let chunkIndex = 0;
      for (let offset = 0; offset < pcm.length; offset += chunkSize) {
        if (signal?.aborted) throw abortError();
        const chunk = pcm.subarray(offset, Math.min(offset + chunkSize, pcm.length));
        const chunkDurationMs = chunk.length / 2 / SAMPLE_RATE * 1000;
        onChunk({
          sampleRate: SAMPLE_RATE,
          pcm16: chunk.toString("base64"),
          chunkIndex,
          elapsedMs,
          audioDurationMs: chunkDurationMs,
        });
        console.info("[whalepartner:voice]", JSON.stringify({
          event: "tts-chunk",
          requestId,
          turnId: context?.turnId,
          segmentIndex: context?.segmentIndex,
          chunkIndex,
          elapsedMs: Math.round(elapsedMs * 10) / 10,
          audioDurationMs: Math.round(chunkDurationMs * 10) / 10,
          sampleRate: SAMPLE_RATE,
        }));
        chunkIndex += 1;
      }

      const rtf = elapsedMs / audioDurationMs;
      console.info("[whalepartner:voice]", JSON.stringify({
        event: "tts-segment-done",
        requestId,
        turnId: context?.turnId,
        segmentIndex: context?.segmentIndex,
        chunkCount: chunkIndex,
        textLength: text.length,
        elapsedMs: Math.round(elapsedMs * 10) / 10,
        audioDurationMs: Math.round(audioDurationMs * 10) / 10,
        rtf: Math.round(rtf * 1000) / 1000,
      }));
      await this.#removeLegacyTtsData().catch((error: unknown) => {
        console.warn("[whalepartner:voice] legacy TTS cleanup failed:", error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new Error("本地语音生成超时，请重试。");
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortRequest);
      this.#activeRequests.delete(controller);
    }
  }

  async close(): Promise<void> {
    process.removeListener("exit", this.#processExit);
    this.#closing = true;
    for (const controller of this.#activeRequests) controller.abort();
    this.#setupProcesses.close();
    await this.#stopServer();
  }

  #hasVoiceProfile(): boolean {
    return existsSync(this.#voiceReferencePath) && existsSync(this.#voiceMetadataPath);
  }

  async #stopServer(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#serverUrl = null;
    if (!server || server.exitCode !== null) return;
    const closed = new Promise<void>((resolveClose) => server.once("close", () => resolveClose()));
    server.kill("SIGTERM");
    const killed = setTimeout(() => server.kill("SIGKILL"), 2_000);
    await closed;
    clearTimeout(killed);
  }

  async #prepare(): Promise<void> {
    this.#voiceProfile = await this.#readVoiceProfile();
    if (!cosyVoiceNativeRuntimeIsReady(this.#runtimeDirectory, this.#deploymentTarget)) await this.#installRuntime();
    if (!cosyVoiceModelIsReady(this.#modelDirectory)) await this.#installModel();
    await this.#startNativeServer();
  }

  async #readVoiceProfile(): Promise<VoiceProfile> {
    let metadata: unknown;
    try {
      metadata = JSON.parse(await readFile(this.#voiceMetadataPath, "utf8")) as unknown;
    } catch {
      throw new Error("无法读取大肥鱼的 CosyVoice 音色配置。");
    }
    if (!metadata || typeof metadata !== "object") throw new Error("大肥鱼的 CosyVoice 音色配置格式不正确。");
    const profile = metadata as Record<string, unknown>;
    if (profile.model !== MODEL_ID || typeof profile.reference_audio !== "string" || typeof profile.transcript !== "string" || !profile.transcript.trim()) {
      throw new Error("大肥鱼的 CosyVoice 音色配置与当前模型不匹配。");
    }
    const referencePath = resolve(dirname(this.#voiceMetadataPath), profile.reference_audio);
    if (!existsSync(referencePath)) throw new Error("大肥鱼的 CosyVoice 参考音频不存在。");
    return { referencePath, transcript: profile.transcript };
  }

  async #installRuntime(): Promise<void> {
    const setupScript = this.#options.runtimeSetupScriptPath ?? fileURLToPath(new URL("../../scripts/setup-cosyvoice3-native.sh", import.meta.url));
    this.#current = { ...this.#current, message: "正在构建 CosyVoice3 原生 MLX 运行时。" };
    await this.#setupProcesses.run(setupScript, this.#options.dataDirectory, 90 * 60_000, "构建 CosyVoice 原生运行时失败。");
    if (!cosyVoiceNativeRuntimeIsReady(this.#runtimeDirectory, this.#deploymentTarget)) throw new Error("原生 MLX 运行时构建后仍缺少 CosyVoice 服务文件。");
  }

  async #installModel(): Promise<void> {
    const setupScript = this.#options.modelSetupScriptPath ?? fileURLToPath(new URL("../../scripts/prepare-cosyvoice3-mlx-model.sh", import.meta.url));
    this.#current = { ...this.#current, message: "正在下载 CosyVoice3 MLX FP16 模型和语音分词器。" };
    await this.#setupProcesses.run(setupScript, this.#options.dataDirectory, 90 * 60_000, "下载 CosyVoice MLX 模型失败。");
    if (!cosyVoiceModelIsReady(this.#modelDirectory)) throw new Error("CosyVoice MLX 模型下载后仍缺少推理文件。");
  }

  async #startNativeServer(): Promise<void> {
    if (!existsSync(this.#serverPath)) throw new Error("CosyVoice 原生服务程序不存在，请重新准备本地语音运行时。");
    const port = await availablePort();
    const serverUrl = `http://127.0.0.1:${port}`;
    // The native server applies one timeout to every request, so size it for the longest accepted text;
    // the per-request abort in stream() still bounds shorter texts.
    const requestTimeoutSeconds = Math.ceil(ttsRequestTimeoutMs(TTS_MAX_TEXT_LENGTH) / 1000);
    const server = spawn(this.#serverPath, [
      "--model-path", this.#modelDirectory,
      "--model-name", MODEL_ID,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--max-queued-requests", "1",
      "--request-timeout-s", String(requestTimeoutSeconds),
      "--allowed-local-media-path", dirname(this.#voiceMetadataPath),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    this.#server = server;
    this.#serverUrl = serverUrl;
    this.#serverLog = "";
    const saveLog = (chunk: Buffer) => { this.#serverLog = (this.#serverLog + chunk.toString("utf8")).slice(-4000); };
    server.stdout?.on("data", saveLog);
    server.stderr?.on("data", saveLog);
    server.on("error", (error) => this.#failServer(`无法启动 CosyVoice 原生服务：${error.message}`));
    server.on("close", (code) => {
      if (this.#server !== server) return;
      this.#server = null;
      this.#serverUrl = null;
      if (!this.#closing) {
        const detail = this.#serverLog.trim().slice(-600);
        this.#failServer(detail ? `CosyVoice 原生服务已退出：${detail}` : `CosyVoice 原生服务已退出（${code ?? "unknown"}）。`);
      }
    });

    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      if (this.#server !== server || server.exitCode !== null) {
        const detail = this.#serverLog.trim().slice(-800);
        throw new Error(detail ? `CosyVoice 原生服务启动失败：${detail}` : "CosyVoice 原生服务启动失败。");
      }
      try {
        const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(1_500) });
        if (response.ok) {
          await response.arrayBuffer();
          return;
        }
      } catch {
        // The native server does not accept requests until model loading completes.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    }
    server.kill("SIGTERM");
    throw new Error("CosyVoice 原生模型启动超时。");
  }

  async #removeLegacyTtsData(): Promise<void> {
    if (this.#legacyCleanup) return this.#legacyCleanup;
    const dataDirectory = resolve(this.#options.dataDirectory);
    const paths = [
      join(dataDirectory, "models", "tts", "cosyvoice3"),
      join(dataDirectory, "models", "tts", "hf"),
      join(dataDirectory, "runtimes", "tts-cosyvoice3"),
      join(dataDirectory, "runtimes", "cosyvoice3-source"),
      join(dataDirectory, "runtimes", "tts-mlx"),
    ];
    this.#legacyCleanup = (async () => {
      for (const path of paths) {
        const info = await lstat(path).catch(() => null);
        if (info?.isDirectory()) await rm(path, { recursive: true, force: true });
      }
    })();
    return this.#legacyCleanup;
  }

  #failServer(message: string): void {
    if (!this.#closing) this.#current = { ...this.#current, state: "failed", progress: null, message };
  }
}

async function availablePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    listener.once("error", rejectListen);
    listener.listen(0, "127.0.0.1", resolveListen);
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("无法为 CosyVoice 原生服务分配本地端口。");
  await new Promise<void>((resolveClose, rejectClose) => listener.close((error) => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

function readNativeError(body: string): string | null {
  try {
    const value = JSON.parse(body) as { detail?: unknown };
    return typeof value.detail === "string" ? value.detail : null;
  } catch {
    return body.trim() || null;
  }
}

function abortError(): Error {
  const error = new Error("语音生成已取消。");
  error.name = "AbortError";
  return error;
}

function macosDeploymentTarget(): string | null {
  if (process.platform !== "darwin") return null;
  const version = execFileSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
  const major = Number(version.split(".", 1)[0]);
  if (major < 15) return null;
  return "15.0";
}

export function createCosyVoiceTtsService(dataDirectory: string, options: Omit<Partial<CosyVoiceTtsOptions>, "dataDirectory"> = {}): TtsService {
  return new CosyVoiceTtsService({ ...options, dataDirectory });
}
