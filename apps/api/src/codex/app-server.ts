import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { tmpdir } from "node:os";
import type { StoredCodexSettings } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 30000;
const TURN_TIMEOUT_MS = 240000;

export interface CodexEffortOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexModelOption {
  model: string;
  id: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: CodexEffortOption[];
  isDefault: boolean;
}

export interface ResolvedCodexSettings extends StoredCodexSettings {
  modelOption: CodexModelOption;
}

export function resolveCodexSettings(stored: StoredCodexSettings, models: CodexModelOption[]): ResolvedCodexSettings {
  let modelOption: CodexModelOption | undefined;
  if (stored.model) modelOption = models.find((model) => model.model === stored.model);
  else modelOption = models.find((model) => model.isDefault) ?? models[0];

  if (!modelOption) {
    throw new Error(stored.model ? `本机 Codex 当前没有可用模型：${stored.model}` : "本机 Codex 没有可用模型。");
  }

  const effort = stored.effort || modelOption.defaultReasoningEffort;
  const supportedEfforts = modelOption.supportedReasoningEfforts.map((option) => option.reasoningEffort);
  if (!supportedEfforts.includes(effort)) {
    throw new Error(`推理强度 ${effort} 不在 ${modelOption.model} 当前可用列表中：${supportedEfforts.join(" / ")}`);
  }

  return { model: modelOption.model, effort, modelOption };
}

interface JsonRpcMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: unknown; code?: unknown };
}

interface NotificationQueue {
  values: JsonRpcMessage[];
  waiters: Array<{ resolve: (value: JsonRpcMessage) => void; reject: (error: Error) => void }>;
  error?: Error;
}

class CodexAppServer {
  #child?: ChildProcessWithoutNullStreams;
  #reader?: ReadlineInterface;
  #ready?: Promise<void>;
  #nextId = 0;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  #listeners = new Set<(message: JsonRpcMessage) => void>();

  async request(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    throwIfAborted(signal);
    await abortable(this.#ensureReady(), signal);
    throwIfAborted(signal);
    return this.#sendRequest(method, params);
  }

  onNotification(listener: (message: JsonRpcMessage) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async listModels(signal?: AbortSignal): Promise<CodexModelOption[]> {
    const models: CodexModelOption[] = [];
    let cursor: string | null = null;
    do {
      const result = await abortable(this.request("model/list", { includeHidden: false, cursor }, signal), signal) as {
        data?: Array<Partial<CodexModelOption>>;
        nextCursor?: string | null;
      };
      for (const model of result.data ?? []) {
        if (
          typeof model.model === "string" &&
          typeof model.defaultReasoningEffort === "string" &&
          Array.isArray(model.supportedReasoningEfforts)
        ) {
          models.push({
            model: model.model,
            id: typeof model.id === "string" ? model.id : model.model,
            displayName: typeof model.displayName === "string" ? model.displayName : model.model,
            defaultReasoningEffort: model.defaultReasoningEffort,
            supportedReasoningEfforts: model.supportedReasoningEfforts.filter(
              (option): option is CodexEffortOption =>
                typeof option?.reasoningEffort === "string" && typeof option.description === "string",
            ),
            isDefault: model.isDefault === true,
          });
        }
      }
      cursor = result.nextCursor ?? null;
    } while (cursor);
    return models;
  }

  async *stream(prompt: string, settings: StoredCodexSettings, signal?: AbortSignal): AsyncGenerator<string> {
    throwIfAborted(signal);
    const thread = await this.request("thread/start", {
      model: settings.model,
      cwd: tmpdir(),
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      allowProviderModelFallback: false,
    }, signal) as { thread?: { id?: string } };
    throwIfAborted(signal);
    const threadId = thread.thread?.id;
    if (!threadId) throw new Error("Codex 没有建立对话线程。");

    const queue: NotificationQueue = { values: [], waiters: [] };
    const unsubscribe = this.onNotification((message) => {
      if (message.method !== "codexAppServer/exited" && message.params?.threadId !== threadId) return;
      if (queue.waiters.length > 0) queue.waiters.shift()?.resolve(message);
      else queue.values.push(message);
    });
    let turnId = "";
    let completed = false;
    let hasText = false;
    const onAbort = () => {
      if (turnId) void this.#interrupt(threadId, turnId);
      failQueue(queue, new Error("Codex 对话已取消。"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const started = await this.request("turn/start", {
        threadId,
        model: settings.model,
        effort: settings.effort,
        sandboxPolicy: { type: "readOnly" },
        approvalPolicy: "never",
        input: [{ type: "text", text: prompt }],
      }, signal) as { turn?: { id?: string } };
      turnId = started.turn?.id ?? "";
      if (!turnId) throw new Error("Codex 没有开始这一轮对话。");
      throwIfAborted(signal);

      const timeout = setTimeout(() => failQueue(queue, new Error("Codex 回复超时。")), TURN_TIMEOUT_MS);
      try {
        while (true) {
          const message = await nextNotification(queue);
          if (message.method === "codexAppServer/exited") {
            throw new Error("本机 Codex 服务已退出，请重试。");
          }
          const completedTurn = message.params?.turn as { id?: string } | undefined;
          const eventTurnId = typeof message.params?.turnId === "string" ? message.params.turnId : completedTurn?.id;
          if (eventTurnId !== turnId) continue;

          if (message.method === "item/agentMessage/delta" && typeof message.params?.delta === "string") {
            hasText = true;
            yield message.params.delta;
          }

          if (message.method === "turn/completed") {
            const turn = message.params?.turn as { status?: string; error?: { message?: unknown } } | undefined;
            if (turn?.status !== "completed") {
              const detail = typeof turn?.error?.message === "string" ? turn.error.message : "Codex 回复失败。";
              throw new Error(detail);
            }
            completed = true;
            break;
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      if (!hasText) throw new Error("Codex 没有返回回复正文。");
    } finally {
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
      if (!completed && turnId) await this.#interrupt(threadId, turnId);
    }
  }

  async close() {
    const child = this.#child;
    this.#child = undefined;
    this.#reader?.close();
    this.#reader = undefined;
    this.#ready = undefined;
    if (child && !child.killed) child.kill("SIGTERM");
  }

  async #ensureReady() {
    if (this.#ready) return this.#ready;
    const child = spawn("codex", ["app-server", "--stdio", "-c", "mcp_servers={}"], { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    this.#child = child;
    this.#reader = createInterface({ input: child.stdout });
    this.#reader.on("line", (line) => this.#readLine(line));
    child.stderr.resume();
    child.once("error", (error) => this.#processExited(error, child));
    // 服务退出后再写 stdin 会报 EPIPE；没有监听的话这个 error 会直接把 API 进程带崩。
    child.stdin.on("error", () => this.#processExited(new Error("Codex 服务的输入通道已断开。"), child));
    child.once("exit", (code, signal) => {
      const detail = code === 0 ? "Codex 服务已关闭。" : `Codex 服务退出（${code ?? signal ?? "unknown"}）。`;
      this.#processExited(new Error(detail), child);
    });

    this.#ready = (async () => {
      await this.#sendRequest("initialize", {
        clientInfo: { name: "whalepartner-local", title: "WhalePartner local model adapter", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      this.#sendNotification("initialized", {});
    })();

    try {
      await this.#ready;
    } catch (error) {
      // 初始化失败（比如超时）的进程不能再用：结束它并清掉状态，否则下一次请求会再起一个，把它留成孤儿进程。
      this.#processExited(error instanceof Error ? error : new Error(String(error)), child);
      throw error;
    }
  }

  #sendRequest(method: string, params: Record<string, unknown>) {
    const child = this.#child;
    if (!child || child.killed || !child.stdin.writable) return Promise.reject(new Error("本机 Codex 服务不可用。"));
    const id = ++this.#nextId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex 请求超时：${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  #sendNotification(method: string, params: Record<string, unknown>) {
    const child = this.#child;
    if (child && !child.killed && child.stdin.writable) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    }
  }

  #readLine(line: string) {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      if (message.error) {
        const detail = typeof message.error.message === "string" ? message.error.message : "Codex 请求失败。";
        pending.reject(new Error(detail));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    for (const listener of this.#listeners) listener(message);
  }

  #processExited(error: Error, child: ChildProcessWithoutNullStreams) {
    if (this.#child !== child) return;
    this.#child = undefined;
    this.#reader?.close();
    this.#reader = undefined;
    this.#ready = undefined;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
    for (const listener of this.#listeners) {
      listener({ method: "codexAppServer/exited", params: { message: error.message } });
    }
    if (child && !child.killed) child.kill("SIGTERM");
  }

  async #interrupt(threadId: string, turnId: string) {
    if (!this.#child || !this.#ready) return;
    try {
      await this.request("turn/interrupt", { threadId, turnId });
    } catch {
      return;
    }
  }
}

function nextNotification(queue: NotificationQueue): Promise<JsonRpcMessage> {
  if (queue.error) return Promise.reject(queue.error);
  if (queue.values.length > 0) return Promise.resolve(queue.values.shift()!);
  return new Promise((resolve, reject) => queue.waiters.push({ resolve, reject }));
}

function failQueue(queue: NotificationQueue, error: Error) {
  if (queue.error) return;
  queue.error = error;
  queue.values = [];
  for (const waiter of queue.waiters) waiter.reject(error);
  queue.waiters = [];
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Codex 对话已取消。");
}

/** 等待期间一旦中止就立刻拒绝；底层请求自己按超时清理，不会留下悬挂的等待。 */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Codex 对话已取消。"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

let appServer: CodexAppServer | undefined;

function getAppServer() {
  appServer ??= new CodexAppServer();
  return appServer;
}

export function listCodexModels(signal?: AbortSignal) {
  return getAppServer().listModels(signal);
}

export function streamWithCodexAppServer(prompt: string, settings: StoredCodexSettings, signal?: AbortSignal) {
  return getAppServer().stream(prompt, settings, signal);
}

export async function closeCodexAppServer() {
  await appServer?.close();
  appServer = undefined;
}
