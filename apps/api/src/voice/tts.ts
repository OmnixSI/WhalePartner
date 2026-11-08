import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const execFileAsync = promisify(execFile);
export const TTS_MODEL = "Qwen3-TTS 1.7B · MLX 4-bit · Serena";
export type TtsEmotion = "neutral" | "happy" | "sad" | "angry" | "surprised" | "relaxed";

export interface TtsStatus {
  state: "idle" | "loading" | "ready" | "failed";
  progress: number | null;
  message: string;
  model: string;
  speaker: string;
}

export interface TtsAudioChunk {
  sampleRate: number;
  pcm16: string;
}

export interface TtsService {
  status(): TtsStatus;
  warm(): Promise<void>;
  stream(text: string, emotion: TtsEmotion, onChunk: (chunk: TtsAudioChunk) => void, signal?: AbortSignal): Promise<void>;
  close?(): Promise<void>;
}

interface WorkerMessage {
  type: "ready" | "chunk" | "done" | "cancelled" | "error";
  requestId?: string;
  message?: string;
  sampleRate?: number;
  pcm16?: string;
}

interface PendingRequest {
  onChunk(chunk: TtsAudioChunk): void;
  resolve(): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abort?: () => void;
}

export interface MlxTtsOptions {
  dataDirectory: string;
  pythonPath?: string;
  workerPath?: string;
  setupScriptPath?: string;
}

export class MlxTtsService implements TtsService {
  readonly #options: MlxTtsOptions;
  readonly #pythonPath: string;
  readonly #modelCache: string;
  #current: TtsStatus;
  #warmPromise: Promise<void> | null = null;
  #worker: ChildProcessWithoutNullStreams | null = null;
  #pending = new Map<string, PendingRequest>();
  #readyResolve: (() => void) | null = null;
  #readyReject: ((error: Error) => void) | null = null;
  #closing = false;
  readonly #supported: boolean;
  readonly #processExit = () => this.#worker?.kill();

  constructor(options: MlxTtsOptions) {
    this.#options = options;
    const dataDirectory = resolve(options.dataDirectory);
    this.#pythonPath = options.pythonPath ?? join(dataDirectory, "runtimes", "tts-mlx", "bin", "python");
    this.#modelCache = join(dataDirectory, "models", "tts", "hf");
    this.#supported = process.platform === "darwin" && process.arch === "arm64";
    this.#current = {
      state: this.#supported ? "idle" : "failed",
      progress: null,
      message: this.#supported ? "待准备" : "本地情绪语音需要 Apple Silicon Mac。",
      model: TTS_MODEL,
      speaker: "Serena",
    };
    process.once("exit", this.#processExit);
  }

  status(): TtsStatus {
    return { ...this.#current };
  }

  warm(): Promise<void> {
    if (this.#current.state === "ready" && this.#worker) return Promise.resolve();
    if (this.#warmPromise) return this.#warmPromise;
    if (!this.#supported) return Promise.reject(new Error(this.#current.message));
    this.#current = { ...this.#current, state: "loading", progress: null, message: "正在准备本地情绪语音模型。首次启动会下载模型。" };
    this.#warmPromise = this.#prepare().then(() => {
      this.#current = { ...this.#current, state: "ready", progress: 100, message: "本地情绪语音已就绪。" };
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.#current = { ...this.#current, state: "failed", progress: null, message };
      throw error instanceof Error ? error : new Error(message);
    }).finally(() => {
      this.#warmPromise = null;
    });
    return this.#warmPromise;
  }

  async stream(text: string, emotion: TtsEmotion, onChunk: (chunk: TtsAudioChunk) => void, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    await this.warm();
    if (signal?.aborted) throw abortError();
    const requestId = randomUUID();
    await new Promise<void>((resolveRequest, rejectRequest) => {
      const worker = this.#worker;
      if (!worker || worker.killed) {
        rejectRequest(new Error("本地情绪语音运行时没有启动。"));
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
      };
      pending.abort = () => {
        if (!this.#pending.has(requestId)) return;
        this.#write({ action: "cancel", targetRequestId: requestId });
      };
      signal?.addEventListener("abort", pending.abort, { once: true });
      this.#pending.set(requestId, pending);
      this.#write({ action: "synthesize", requestId, text, emotion }, (error) => {
        if (error) this.#rejectRequest(requestId, error);
      });
    });
  }

  async close(): Promise<void> {
    process.removeListener("exit", this.#processExit);
    this.#closing = true;
    this.#readyResolve = null;
    this.#readyReject = null;
    for (const requestId of this.#pending.keys()) this.#rejectRequest(requestId, new Error("本地情绪语音已关闭。"));
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
    await this.#startWorker();
  }

  async #runtimeIsReady(): Promise<boolean> {
    try {
      await execFileAsync(this.#pythonPath, ["-c", "import mlx.core, mlx_audio.tts.utils"], { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  async #installRuntime(): Promise<void> {
    const setupScript = this.#options.setupScriptPath ?? fileURLToPath(new URL("../../scripts/setup-tts-runtime.sh", import.meta.url));
    if (!existsSync(setupScript)) throw new Error("本地情绪语音运行环境缺少安装脚本，请重新安装 WhalePartner。");
    this.#current = { ...this.#current, message: "正在 WhalePartner 独立运行环境中准备语音组件。" };
    await new Promise<void>((resolveSetup, rejectSetup) => {
      const child = spawn("bash", [setupScript], {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, WP_DATA_DIR: resolve(this.#options.dataDirectory) },
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2500); });
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        rejectSetup(new Error("安装本地语音运行环境超时，请检查网络后重试。"));
      }, 15 * 60_000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        rejectSetup(new Error(`无法准备本地语音运行环境：${error.message}`));
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolveSetup();
        else rejectSetup(new Error(stderr.trim() || `安装本地语音运行环境失败（${code ?? "unknown"}）。`));
      });
    });
    if (!(await this.#runtimeIsReady())) throw new Error("本地语音运行环境安装后仍无法载入 MLX-Audio。");
  }

  async #startWorker(): Promise<void> {
    const workerPath = this.#options.workerPath ?? fileURLToPath(new URL("./tts_worker.py", import.meta.url));
    const worker = spawn(this.#pythonPath, ["-u", workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HF_HOME: this.#modelCache,
        HF_HUB_CACHE: join(this.#modelCache, "hub"),
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
      try { pending.onChunk({ sampleRate: reply.sampleRate, pcm16: reply.pcm16 }); }
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
      callback?.(new Error("本地情绪语音运行时没有启动。"));
      return;
    }
    worker.stdin.write(`${JSON.stringify(message)}\n`, callback);
  }

  #resolveRequest(requestId: string): void {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    this.#pending.delete(requestId);
    this.#clearPending(pending);
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

export function createMlxTtsService(dataDirectory: string, options: Omit<Partial<MlxTtsOptions>, "dataDirectory"> = {}): TtsService {
  return new MlxTtsService({ ...options, dataDirectory });
}
