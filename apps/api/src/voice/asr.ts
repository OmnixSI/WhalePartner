import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const execFileAsync = promisify(execFile);

export const XASR_MODEL = "X-ASR Chinese-English streaming · 480 ms";
const ARCHIVE = "sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05";
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ARCHIVE}.tar.bz2`;
const REQUIRED_MODEL_FILES = ["encoder.int8.onnx", "decoder.onnx", "joiner.int8.onnx", "tokens.txt", "bpe.vocab"];

export interface AsrStatus {
  state: "idle" | "loading" | "ready" | "failed";
  progress: number | null;
  message: string;
  model: string;
}

export interface AsrUpdate {
  text: string;
  final: boolean;
}

export interface AsrStream {
  acceptPcm(pcm: Buffer): Promise<AsrUpdate>;
  close(): Promise<void>;
}

export interface AsrService {
  status(): AsrStatus;
  warm(): Promise<void>;
  createStream(): Promise<AsrStream>;
  close?(): Promise<void>;
}

interface WorkerReply {
  requestId?: string;
  type: "ready" | "reply" | "error";
  ok?: boolean;
  text?: string;
  final?: boolean;
  message?: string;
}

interface PendingRequest {
  resolve(value: WorkerReply): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface XAsrOptions {
  dataDirectory: string;
  pythonPath?: string;
  workerPath?: string;
  vocabularyPath?: string;
  setupScriptPath?: string;
}

/** Local sherpa-onnx worker for the X-ASR 480 ms model used by InterviewHacker. */
export class XAsrService implements AsrService {
  readonly #options: XAsrOptions;
  readonly #modelDirectory: string;
  #current: AsrStatus = { state: "idle", progress: null, message: "待准备", model: XASR_MODEL };
  #warmPromise: Promise<void> | null = null;
  #worker: ChildProcessWithoutNullStreams | null = null;
  #pending = new Map<string, PendingRequest>();
  #readyResolve: (() => void) | null = null;
  #readyReject: ((error: Error) => void) | null = null;
  readonly #processExit = () => this.#worker?.kill();

  constructor(options: XAsrOptions) {
    this.#options = options;
    this.#modelDirectory = join(resolve(options.dataDirectory), "models", ARCHIVE);
    process.once("exit", this.#processExit);
  }

  status(): AsrStatus {
    return { ...this.#current };
  }

  warm(): Promise<void> {
    if (this.#current.state === "ready" && this.#worker) return Promise.resolve();
    if (this.#warmPromise) return this.#warmPromise;
    this.#current = { state: "loading", progress: 0, message: "正在准备 X-ASR 480 ms 中英模型。", model: XASR_MODEL };
    this.#warmPromise = this.#prepare().then(() => {
      this.#current = { state: "ready", progress: 100, message: "X-ASR 流式识别已就绪。", model: XASR_MODEL };
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.#current = { state: "failed", progress: null, message, model: XASR_MODEL };
      throw error instanceof Error ? error : new Error(message);
    }).finally(() => {
      this.#warmPromise = null;
    });
    return this.#warmPromise;
  }

  async createStream(): Promise<AsrStream> {
    await this.warm();
    const id = randomUUID();
    await this.#request({ action: "start", streamId: id });
    let closed = false;
    return {
      acceptPcm: async (pcm) => {
        if (closed) throw new Error("语音识别会话已经结束。");
        if (pcm.length === 0 || pcm.length % 2 !== 0) throw new Error("X-ASR 音频块必须是 16 kHz 单声道 PCM16。");
        const reply = await this.#request({ action: "audio", streamId: id, pcm: pcm.toString("base64") });
        return { text: reply.text ?? "", final: reply.final === true };
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await this.#request({ action: "close", streamId: id }).catch(() => undefined);
      },
    };
  }

  async close(): Promise<void> {
    process.removeListener("exit", this.#processExit);
    const worker = this.#worker;
    this.#worker = null;
    this.#readyResolve = null;
    this.#readyReject = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("本地 X-ASR 已关闭。"));
    }
    this.#pending.clear();
    if (!worker) return;
    worker.stdin.end(JSON.stringify({ action: "shutdown" }) + "\n");
    const killed = setTimeout(() => worker.kill("SIGKILL"), 1500);
    await new Promise<void>((resolveClose) => {
      worker.once("close", () => resolveClose());
      if (worker.exitCode !== null) resolveClose();
    });
    clearTimeout(killed);
  }

  async #prepare(): Promise<void> {
    await this.#ensureRuntime();
    await this.#installModel();
    await this.#startWorker();
  }

  async #ensureRuntime(): Promise<void> {
    if (this.#options.workerPath && existsSync(this.#options.workerPath)) return;
    if (process.env.WP_XASR_WORKER && existsSync(process.env.WP_XASR_WORKER)) return;
    const python = this.#pythonPath();
    if (!python) throw new Error("找不到 X-ASR 本机 Python 运行时。请安装 Python 3.10 或更新版本后重试。");
    try {
      await execFileAsync(python, ["-c", "import numpy, sherpa_onnx"], { timeout: 10_000 });
      return;
    } catch {
      const setupScript = this.#options.setupScriptPath ?? fileURLToPath(new URL("../../scripts/setup-xasr-runtime.sh", import.meta.url));
      if (!existsSync(setupScript)) throw new Error("X-ASR 本机运行时缺少 sherpa-onnx，且安装脚本不在应用资源中。");
      await execFileAsync("bash", [setupScript], {
        timeout: 20 * 60_000,
        env: { ...process.env, WP_DATA_DIR: resolve(this.#options.dataDirectory) },
        maxBuffer: 8 * 1024 * 1024,
      });
    }
  }

  async #installModel(): Promise<void> {
    if (await this.#modelIsUsable(this.#modelDirectory)) return;
    const temporaryDirectory = `${this.#modelDirectory}.install-${randomUUID()}`;
    await mkdir(dirname(this.#modelDirectory), { recursive: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
    await mkdir(temporaryDirectory, { recursive: true });
    try {
      await this.#downloadModel(temporaryDirectory);
      const vocabulary = await this.#vocabularyPath();
      if (!(await exists(join(temporaryDirectory, "bpe.vocab")))) await cp(vocabulary, join(temporaryDirectory, "bpe.vocab"));
      if (!(await this.#modelIsUsable(temporaryDirectory))) throw new Error("X-ASR 模型文件不完整，无法启动识别。");
      await rm(this.#modelDirectory, { recursive: true, force: true });
      await rename(temporaryDirectory, this.#modelDirectory);
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async #downloadModel(destination: string): Promise<void> {
    const response = await fetch(MODEL_URL);
    if (!response.ok || !response.body) throw new Error(`下载 X-ASR 模型失败（HTTP ${response.status}）。`);
    const archive = join(destination, "model.tar.bz2");
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archive));
    const staging = join(destination, "extract");
    await mkdir(staging, { recursive: true });
    try {
      await execFileAsync("tar", ["-xjf", archive, "-C", staging], { maxBuffer: 4 * 1024 * 1024 });
    } catch {
      throw new Error("X-ASR 模型压缩包解压失败。");
    }
    const extracted = join(staging, ARCHIVE);
    for (const name of REQUIRED_MODEL_FILES.filter((item) => item !== "bpe.vocab")) {
      await cp(join(extracted, name), join(destination, name));
    }
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }

  async #vocabularyPath(): Promise<string> {
    if (this.#options.vocabularyPath) return this.#options.vocabularyPath;
    const fromSource = new URL("./assets/xasr-bpe.vocab", import.meta.url);
    if (await exists(fileURLToPath(fromSource))) return fileURLToPath(fromSource);
    const fromBundle = new URL("./voice/assets/xasr-bpe.vocab", import.meta.url);
    if (await exists(fileURLToPath(fromBundle))) return fileURLToPath(fromBundle);
    throw new Error("X-ASR 分词词表不在应用资源中。");
  }

  async #modelIsUsable(directory: string): Promise<boolean> {
    try {
      const [encoder, decoder, joiner, tokens, vocab] = await Promise.all(
        REQUIRED_MODEL_FILES.map((name) => stat(join(directory, name))),
      );
      return encoder.size > 100_000_000 && decoder.size > 1_000_000 && joiner.size > 500_000
        && tokens.size > 10_000 && vocab.size > 10_000;
    } catch {
      return false;
    }
  }

  async #startWorker(): Promise<void> {
    if (this.#worker) return;
    const args = [this.#modelDirectory];
    const binary = this.#options.workerPath ?? process.env.WP_XASR_WORKER ?? findOnPath("whale-xasr-worker");
    const python = this.#pythonPath();
    const script = fileURLToPath(new URL("./xasr_worker.py", import.meta.url));
    const executable = binary ?? python;
    if (!executable) throw new Error("找不到 X-ASR 本机运行时。请重新安装 WhalePartner 语音组件后重试。");
    const commandArgs = binary ? args : ["-u", script, ...args];
    const child = spawn(executable, commandArgs, { stdio: ["pipe", "pipe", "pipe"] });
    this.#worker = child;
    const ready = new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error("X-ASR 初始化超时，请重试。")), 60_000);
      this.#readyResolve = () => { clearTimeout(timeout); resolveReady(); };
      this.#readyReject = (error) => { clearTimeout(timeout); rejectReady(error); };
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#receiveWorkerLine(line));
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-3000); });
    child.on("error", (error) => this.#failWorker(`无法启动 X-ASR：${error.message}`));
    child.on("close", (code) => {
      if (this.#worker !== child) return;
      this.#worker = null;
      const message = stderr.trim() ? `X-ASR 运行时已退出：${stderr.trim().slice(-500)}` : `X-ASR 运行时已退出（${code ?? "unknown"}）。`;
      this.#failWorker(message);
      if (code !== 0) console.warn(message);
    });
    child.stdin.on("error", () => {});
    await ready;
  }

  #pythonPath(): string | null {
    if (this.#options.pythonPath) return this.#options.pythonPath;
    const dataPython = join(resolve(this.#options.dataDirectory), "runtimes", "asr-sherpa", "bin", "python");
    if (existsSync(dataPython)) return dataPython;
    return process.env.WP_XASR_PYTHON || findOnPath("python3.12") || findOnPath("python3");
  }

  #request(payload: Record<string, unknown>): Promise<WorkerReply> {
    const worker = this.#worker;
    if (!worker || worker.killed) return Promise.reject(new Error("本地 X-ASR 运行时没有启动。"));
    const requestId = randomUUID();
    return new Promise((resolveReply, rejectReply) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        rejectReply(new Error("X-ASR 没有及时响应，请重试。"));
      }, 10_000);
      this.#pending.set(requestId, { resolve: resolveReply, reject: rejectReply, timer });
      worker.stdin.write(`${JSON.stringify({ ...payload, requestId })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(requestId);
        rejectReply(error);
      });
    });
  }

  #receiveWorkerLine(line: string): void {
    let reply: WorkerReply;
    try { reply = JSON.parse(line) as WorkerReply; }
    catch { return this.#failWorker("X-ASR 运行时返回了无法读取的响应。"); }
    if (reply.type === "ready") {
      this.#readyResolve?.();
      this.#readyResolve = null;
      this.#readyReject = null;
      return;
    }
    if (reply.type === "error" && !reply.requestId) {
      this.#failWorker(reply.message ?? "X-ASR 模型载入失败。");
      return;
    }
    if (!reply.requestId) return;
    const pending = this.#pending.get(reply.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(reply.requestId);
    if (reply.ok === false) pending.reject(new Error(reply.message ?? "X-ASR 识别失败。"));
    else pending.resolve(reply);
  }

  #failWorker(message: string): void {
    this.#readyReject?.(new Error(message));
    this.#readyResolve = null;
    this.#readyReject = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.#pending.clear();
    if (this.#current.state !== "loading") this.#current = { state: "failed", progress: null, message, model: XASR_MODEL };
  }
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function findOnPath(command: string): string | null {
  for (const directory of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const path = join(directory, command);
    if (existsSync(path)) return path;
  }
  return null;
}

export function createXAsrAsrService(dataDirectory: string, options: Omit<XAsrOptions, "dataDirectory"> = {}): AsrService {
  return new XAsrService({ dataDirectory, ...options });
}
