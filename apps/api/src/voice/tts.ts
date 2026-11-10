import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import type { Emotion } from "../emotion.ts";

const execFileAsync = promisify(execFile);
export const TTS_MODEL = "CosyVoice3-0.5B · MPS";
export const TTS_VOICE_PROFILE = "voices/big-fish/keli_voice/speaker.pt";
export const TTS_VOICE_METADATA = "voices/big-fish/keli_voice/voice.json";
export const COSYVOICE_MODEL_FILES = [
  "cosyvoice3.yaml",
  "llm.pt",
  "flow.pt",
  "hift.pt",
  "campplus.onnx",
  "speech_tokenizer_v3.onnx",
  "CosyVoice-BlankEN/config.json",
  "CosyVoice-BlankEN/generation_config.json",
  "CosyVoice-BlankEN/merges.txt",
  "CosyVoice-BlankEN/model.safetensors",
  "CosyVoice-BlankEN/tokenizer_config.json",
  "CosyVoice-BlankEN/vocab.json",
] as const;

export function cosyVoiceModelIsReady(modelDirectory: string): boolean {
  return COSYVOICE_MODEL_FILES.every((file) => existsSync(join(modelDirectory, file)));
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
  stream(text: string, onChunk: (chunk: TtsAudioChunk) => void, signal?: AbortSignal, context?: TtsStreamContext): Promise<void>;
  close?(): Promise<void>;
}

interface WorkerMessage {
  type: "ready" | "chunk" | "done" | "cancelled" | "error";
  requestId?: string;
  message?: string;
  sampleRate?: number;
  pcm16?: string;
  chunkIndex?: number;
  elapsedMs?: number;
  audioDurationMs?: number;
}

interface PendingRequest {
  onChunk(chunk: TtsAudioChunk): void;
  resolve(): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abort?: () => void;
  turnId?: string;
  segmentIndex?: number;
  emotion?: Emotion;
  characterId?: string;
  startedAt: number;
  lastChunkAt?: number;
  chunkIndex: number;
  textLength: number;
}

export interface CosyVoiceTtsOptions {
  dataDirectory: string;
  pythonPath?: string;
  workerPath?: string;
  setupScriptPath?: string;
  modelSetupScriptPath?: string;
  voiceProfilePath?: string;
  voiceMetadataPath?: string;
}

export class CosyVoiceTtsService implements TtsService {
  readonly #options: CosyVoiceTtsOptions;
  readonly #pythonPath: string;
  readonly #modelDirectory: string;
  readonly #sourceDirectory: string;
  readonly #voiceProfilePath: string;
  readonly #voiceMetadataPath: string;
  #current: TtsStatus;
  #warmPromise: Promise<void> | null = null;
  #legacyCleanup: Promise<void> | null = null;
  #worker: ChildProcessWithoutNullStreams | null = null;
  #pending = new Map<string, PendingRequest>();
  #readyResolve: (() => void) | null = null;
  #readyReject: ((error: Error) => void) | null = null;
  #closing = false;
  readonly #supported: boolean;
  readonly #processExit = () => this.#worker?.kill();

  constructor(options: CosyVoiceTtsOptions) {
    this.#options = options;
    const dataDirectory = resolve(options.dataDirectory);
    this.#pythonPath = options.pythonPath ?? join(dataDirectory, "runtimes", "tts-cosyvoice3", "bin", "python");
    this.#modelDirectory = join(dataDirectory, "models", "tts", "cosyvoice3");
    this.#sourceDirectory = join(dataDirectory, "runtimes", "cosyvoice3-source");
    this.#voiceProfilePath = resolve(options.voiceProfilePath ?? join(dataDirectory, TTS_VOICE_PROFILE));
    this.#voiceMetadataPath = resolve(options.voiceMetadataPath ?? join(dataDirectory, TTS_VOICE_METADATA));
    this.#supported = process.platform === "darwin" && process.arch === "arm64";
    this.#current = {
      state: this.#supported ? "waiting_reference" : "failed",
      progress: null,
      message: this.#supported ? "等待导入大肥鱼的 CosyVoice 音色配置。" : "本地语音合成需要 Apple Silicon Mac。",
      model: TTS_MODEL,
      speaker: "大肥鱼预设音色",
    };
    process.once("exit", this.#processExit);
  }

  status(): TtsStatus {
    return { ...this.#current };
  }

  warm(): Promise<void> {
    if (!this.#legacyCleanup) this.#legacyCleanup = this.#removeLegacyTtsData();
    return this.#legacyCleanup.then(() => this.#warmAfterLegacyCleanup());
  }

  #warmAfterLegacyCleanup(): Promise<void> {
    if (!this.#supported) return Promise.reject(new Error(this.#current.message));
    if (!existsSync(this.#voiceProfilePath) || !existsSync(this.#voiceMetadataPath)) {
      this.#current = { ...this.#current, state: "waiting_reference", progress: null, message: "等待导入大肥鱼的 CosyVoice 音色配置。" };
      return Promise.resolve();
    }
    if (this.#worker) {
      this.#current = { ...this.#current, state: "ready", progress: 100, message: "CosyVoice 本地语音已就绪。" };
      return Promise.resolve();
    }
    if (this.#warmPromise) return this.#warmPromise;
    this.#current = { ...this.#current, state: "loading", progress: null, message: "正在准备本地语音模型。首次启动会下载模型。" };
    this.#warmPromise = this.#prepare().then(() => {
      this.#current = { ...this.#current, state: "ready", progress: 100, message: "本地语音已就绪。" };
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.#current = { ...this.#current, state: "failed", progress: null, message };
      throw error instanceof Error ? error : new Error(message);
    }).finally(() => {
      this.#warmPromise = null;
    });
    return this.#warmPromise;
  }

  async #removeLegacyTtsData(): Promise<void> {
    const dataDirectory = resolve(this.#options.dataDirectory);
    for (const relativePath of [["models", "tts", "hf"], ["runtimes", "tts-mlx"]]) {
      const path = join(dataDirectory, ...relativePath);
      const info = await lstat(path).catch(() => null);
      if (info?.isDirectory() && !info.isSymbolicLink()) await rm(path, { recursive: true, force: true });
    }
  }

  async stream(text: string, onChunk: (chunk: TtsAudioChunk) => void, signal?: AbortSignal, context?: TtsStreamContext): Promise<void> {
    if (signal?.aborted) throw abortError();
    await this.warm();
    if (signal?.aborted) throw abortError();
    if (this.#current.state !== "ready") throw new Error(this.#current.message);
    const requestId = randomUUID();
    await new Promise<void>((resolveRequest, rejectRequest) => {
      const worker = this.#worker;
      if (!worker || worker.killed) {
        rejectRequest(new Error("本地语音运行时没有启动。"));
        return;
      }
      const pending: PendingRequest = {
        onChunk,
        resolve: resolveRequest,
        reject: rejectRequest,
        timer: setTimeout(() => {
          this.#write({ action: "cancel", targetRequestId: requestId });
          this.#rejectRequest(requestId, new Error("本地语音生成超时，请重试。"));
        }, 120_000),
        signal,
        turnId: context?.turnId,
        segmentIndex: context?.segmentIndex,
        emotion: context?.emotion,
        characterId: context?.characterId,
        startedAt: performance.now(),
        chunkIndex: 0,
        textLength: text.length,
      };
      pending.abort = () => {
        if (!this.#pending.has(requestId)) return;
        this.#write({ action: "cancel", targetRequestId: requestId });
      };
      signal?.addEventListener("abort", pending.abort, { once: true });
      this.#pending.set(requestId, pending);
      console.info("[whalepartner:voice]", JSON.stringify({
        event: "tts-segment-start",
        turnId: pending.turnId,
        segmentIndex: pending.segmentIndex,
        emotion: pending.emotion,
        characterId: pending.characterId,
        textLength: pending.textLength,
        at: Date.now(),
      }));
      this.#write({
        action: "synthesize",
        requestId,
        text,
        turnId: pending.turnId,
        segmentIndex: pending.segmentIndex,
        emotion: pending.emotion,
        characterId: pending.characterId,
      }, (error) => {
        if (error) this.#rejectRequest(requestId, error);
      });
    });
  }

  async close(): Promise<void> {
    process.removeListener("exit", this.#processExit);
    this.#closing = true;
    this.#readyResolve = null;
    this.#readyReject = null;
    for (const requestId of this.#pending.keys()) this.#rejectRequest(requestId, new Error("本地语音已关闭。"));
    const worker = this.#worker;
    this.#worker = null;
    if (!worker) return;
    worker.stdin.end(JSON.stringify({ action: "shutdown" }) + "\n");
    const killed = setTimeout(() => worker.kill("SIGKILL"), 2000);
    await new Promise<void>((resolveClose) => {
      worker.once("close", () => resolveClose());
      if (worker.exitCode !== null) resolveClose();
    });
    clearTimeout(killed);
  }

  async #prepare(): Promise<void> {
    if (!existsSync(this.#pythonPath) || !(await this.#runtimeIsReady())) {
      await this.#installRuntime();
    }
    if (!(await this.#modelIsReady())) await this.#installModel();
    await this.#startWorker();
  }

  async #runtimeIsReady(): Promise<boolean> {
    try {
      await execFileAsync(this.#pythonPath, ["-c", "import torch, torchaudio, onnxruntime; from cosyvoice.cli.cosyvoice import CosyVoice3"], {
        timeout: 30_000,
        env: this.#workerEnvironment(),
      });
      return true;
    } catch {
      return false;
    }
  }

  async #modelIsReady(): Promise<boolean> {
    return cosyVoiceModelIsReady(this.#modelDirectory);
  }

  async #installRuntime(): Promise<void> {
    const setupScript = this.#options.setupScriptPath ?? fileURLToPath(new URL("../../scripts/setup-cosyvoice3-runtime.sh", import.meta.url));
    if (!existsSync(setupScript)) throw new Error("本地语音运行环境缺少安装脚本，请重新安装 WhalePartner。");
    this.#current = { ...this.#current, message: "正在 WhalePartner 独立运行环境中准备 CosyVoice 组件。" };
    await new Promise<void>((resolveSetup, rejectSetup) => {
      const child = spawn("bash", [setupScript], {
        stdio: ["ignore", "ignore", "pipe"],
        env: this.#workerEnvironment(),
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2500); });
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        rejectSetup(new Error("安装本地语音运行环境超时，请检查网络后重试。"));
      }, 90 * 60_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        rejectSetup(new Error(`无法准备本地语音运行环境：${error.message}`));
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolveSetup();
        else rejectSetup(new Error(stderr.trim() || `安装 CosyVoice 运行环境失败（${code ?? "unknown"}）。`));
      });
    });
    if (!(await this.#runtimeIsReady())) throw new Error("CosyVoice 运行环境安装后仍无法载入推理组件。");
  }

  async #installModel(): Promise<void> {
    const setupScript = this.#options.modelSetupScriptPath ?? fileURLToPath(new URL("../../scripts/prepare-cosyvoice3-model.py", import.meta.url));
    if (!existsSync(setupScript)) throw new Error("CosyVoice 模型准备脚本缺失，请重新安装 WhalePartner。");
    this.#current = { ...this.#current, message: "正在下载 CosyVoice3-0.5B 模型。" };
    await new Promise<void>((resolveSetup, rejectSetup) => {
      const child = spawn(this.#pythonPath, [setupScript, this.#modelDirectory], {
        stdio: ["ignore", "ignore", "pipe"],
        env: this.#workerEnvironment(),
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2500); });
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        rejectSetup(new Error("下载 CosyVoice3-0.5B 超时，请检查网络和可用空间后重试。"));
      }, 90 * 60_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        rejectSetup(new Error(`无法下载 CosyVoice 模型：${error.message}`));
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolveSetup();
        else rejectSetup(new Error(stderr.trim() || `下载 CosyVoice 模型失败（${code ?? "unknown"}）。`));
      });
    });
    if (!(await this.#modelIsReady())) throw new Error("CosyVoice 模型下载后仍缺少推理文件。");
  }

  async #startWorker(): Promise<void> {
    const workerPath = this.#options.workerPath ?? fileURLToPath(new URL("./tts_worker.py", import.meta.url));
    const worker = spawn(this.#pythonPath, ["-u", workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...this.#workerEnvironment(),
        PYTHONUNBUFFERED: "1",
      },
    });
    this.#worker = worker;
    const ready = new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error("本地语音模型载入超时，请重试。")), 15 * 60_000);
      this.#readyResolve = () => { clearTimeout(timeout); resolveReady(); };
      this.#readyReject = (error) => { clearTimeout(timeout); rejectReady(error); };
    });
    const lines = createInterface({ input: worker.stdout });
    lines.on("line", (line) => this.#receiveWorkerLine(line));
    let stderr = "";
    worker.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
    worker.on("error", (error) => this.#failWorker(`无法启动本地语音模型：${error.message}`));
    worker.on("close", (code) => {
      if (this.#worker !== worker) return;
      this.#worker = null;
      if (this.#closing) return;
      const message = stderr.trim() ? `本地语音运行时已退出：${stderr.trim().slice(-600)}` : `本地语音运行时已退出（${code ?? "unknown"}）。`;
      this.#failWorker(message);
    });
    worker.stdin.on("error", () => {});
    try {
      await ready;
    } catch (error) {
      if (this.#worker === worker) this.#worker = null;
      worker.kill();
      throw error;
    }
  }

  #workerEnvironment(): NodeJS.ProcessEnv {
    const dataDirectory = resolve(this.#options.dataDirectory);
    return {
      ...process.env,
      WP_DATA_DIR: dataDirectory,
      WP_COSYVOICE_SOURCE_DIR: this.#sourceDirectory,
      WP_COSYVOICE_MODEL_DIR: this.#modelDirectory,
      WP_COSYVOICE_PROFILE_PATH: this.#voiceProfilePath,
      WP_COSYVOICE_METADATA_PATH: this.#voiceMetadataPath,
      PYTHONPATH: `${join(this.#sourceDirectory, "third_party", "Matcha-TTS")}:${this.#sourceDirectory}`,
      HF_HOME: join(dataDirectory, "models", "tts", "cosyvoice3", "hf"),
      HF_HUB_DISABLE_TELEMETRY: "1",
      MODELSCOPE_CACHE: join(dataDirectory, "models", "tts", "cosyvoice3", "modelscope"),
      PYTORCH_ENABLE_MPS_FALLBACK: "1",
      TOKENIZERS_PARALLELISM: "false",
    };
  }

  #receiveWorkerLine(line: string): void {
    let reply: WorkerMessage;
    try { reply = JSON.parse(line) as WorkerMessage; }
    catch { return this.#failWorker("本地语音运行时返回了无法读取的响应。"); }
    if (reply.type === "ready") {
      this.#readyResolve?.();
      this.#readyResolve = null;
      this.#readyReject = null;
      return;
    }
    if (reply.type === "error" && !reply.requestId) {
      this.#failWorker(reply.message ?? "本地语音模型载入失败。");
      return;
    }
    if (!reply.requestId) return;
    const pending = this.#pending.get(reply.requestId);
    if (!pending) return;
    if (reply.type === "chunk" && reply.pcm16 && reply.sampleRate) {
      const now = performance.now();
      const audioDurationMs = reply.audioDurationMs
        ?? Buffer.from(reply.pcm16, "base64").byteLength / 2 / reply.sampleRate * 1000;
      console.info("[whalepartner:voice]", JSON.stringify({
        event: "tts-chunk",
        turnId: pending.turnId,
        segmentIndex: pending.segmentIndex,
        emotion: pending.emotion,
        characterId: pending.characterId,
        chunkIndex: reply.chunkIndex ?? pending.chunkIndex,
        elapsedMs: Math.round((now - pending.startedAt) * 10) / 10,
        modelElapsedMs: reply.elapsedMs,
        interChunkMs: pending.lastChunkAt === undefined ? null : Math.round((now - pending.lastChunkAt) * 10) / 10,
        audioDurationMs: Math.round(audioDurationMs * 10) / 10,
        sampleRate: reply.sampleRate,
      }));
      pending.lastChunkAt = now;
      pending.chunkIndex += 1;
      try {
        pending.onChunk({
          sampleRate: reply.sampleRate,
          pcm16: reply.pcm16,
          chunkIndex: reply.chunkIndex ?? pending.chunkIndex - 1,
          elapsedMs: reply.elapsedMs,
          audioDurationMs,
        });
      }
      catch (error) {
        this.#write({ action: "cancel", targetRequestId: reply.requestId });
        this.#rejectRequest(reply.requestId, error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (reply.type === "done" || reply.type === "cancelled") {
      this.#resolveRequest(reply.requestId);
      return;
    }
    if (reply.type === "error") this.#rejectRequest(reply.requestId, new Error(reply.message ?? "本地语音生成失败。"));
  }

  #write(message: Record<string, unknown>, callback?: (error?: Error | null) => void): void {
    const worker = this.#worker;
    if (!worker || worker.killed || worker.stdin.destroyed) {
      callback?.(new Error("本地语音运行时没有启动。"));
      return;
    }
    worker.stdin.write(`${JSON.stringify(message)}\n`, callback);
  }

  #resolveRequest(requestId: string): void {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    this.#pending.delete(requestId);
    this.#clearPending(pending);
    console.info("[whalepartner:voice]", JSON.stringify({
      event: "tts-segment-done",
      turnId: pending.turnId,
      segmentIndex: pending.segmentIndex,
      emotion: pending.emotion,
      characterId: pending.characterId,
      chunkCount: pending.chunkIndex,
      textLength: pending.textLength,
      elapsedMs: Math.round((performance.now() - pending.startedAt) * 10) / 10,
    }));
    if (pending.signal?.aborted) pending.reject(abortError());
    else pending.resolve();
  }

  #rejectRequest(requestId: string, error: Error): void {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    this.#pending.delete(requestId);
    this.#clearPending(pending);
    pending.reject(error);
  }

  #clearPending(pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
  }

  #failWorker(message: string): void {
    this.#readyReject?.(new Error(message));
    this.#readyResolve = null;
    this.#readyReject = null;
    for (const requestId of this.#pending.keys()) this.#rejectRequest(requestId, new Error(message));
    if (!this.#closing) this.#current = { ...this.#current, state: "failed", progress: null, message };
  }
}

function abortError(): Error {
  const error = new Error("语音生成已取消。");
  error.name = "AbortError";
  return error;
}

export function createCosyVoiceTtsService(dataDirectory: string, options: Omit<Partial<CosyVoiceTtsOptions>, "dataDirectory"> = {}): TtsService {
  return new CosyVoiceTtsService({ ...options, dataDirectory });
}
