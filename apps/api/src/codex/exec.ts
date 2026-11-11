import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { listCodexModels, resolveCodexSettings } from "./app-server.ts";
import { readStoredCodexSettings, type StoredCodexSettings } from "./settings.ts";

const CODEX_TIMEOUT_MS = 240000;
const KILL_GRACE_MS = 3000;

export interface CodexTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface CodexResult {
  message: string;
  usage?: CodexTokenUsage;
  model?: string;
  reasoningEffort?: string;
}

export function parseCodexResult(output: string): CodexResult {
  let message = "";
  let usage: CodexTokenUsage | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;

    let event: {
      type?: string;
      item?: { type?: string; text?: string };
      usage?: { input_tokens?: unknown; cached_input_tokens?: unknown; output_tokens?: unknown };
    };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      message = event.item.text ?? "";
    }

    if (
      event.type === "turn.completed" &&
      typeof event.usage?.input_tokens === "number" &&
      typeof event.usage.cached_input_tokens === "number" &&
      typeof event.usage.output_tokens === "number"
    ) {
      usage = {
        inputTokens: event.usage.input_tokens,
        cachedInputTokens: event.usage.cached_input_tokens,
        outputTokens: event.usage.output_tokens,
      };
    }
  }

  if (!message.trim()) throw new Error("Codex 没有返回摘要文本。");
  return { message, usage };
}

/** Codex 把接口错误写成 stdout 里的 JSON 事件而不是 stderr；取最后一条错误信息。 */
export function codexErrorFromEvents(output: string) {
  let message = "";
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as { type?: string; message?: unknown; error?: { message?: unknown } };
      if (event.type === "turn.failed" && typeof event.error?.message === "string") message = event.error.message;
      else if (event.type === "error" && typeof event.message === "string" && !message) message = event.message;
    } catch {
      /* 非 JSON 行 */
    }
  }
  try {
    const inner = JSON.parse(message) as { error?: { message?: unknown } };
    if (typeof inner.error?.message === "string") return inner.error.message;
  } catch {
    /* message 本身就是文字 */
  }
  return message;
}

export function parseCodexMessage(output: string) {
  return parseCodexResult(output).message;
}

export function buildCodexArgs(imagePaths: string[], settings: StoredCodexSettings) {
  return [
    "exec",
    "--ephemeral",
    "--json",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "-C",
    tmpdir(),
    "-m",
    settings.model,
    "-c",
    `model_reasoning_effort=${JSON.stringify(settings.effort)}`,
    ...imagePaths.flatMap((path) => ["--image", path]),
    "-",
  ];
}

export async function getCodexRequestSettings(configPath?: string) {
  return resolveCodexSettings(readStoredCodexSettings(configPath), await listCodexModels());
}

/** 结束 Codex 和它拉起的子进程：先 SIGTERM，宽限期后 SIGKILL。 */
function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    /* 已经退出了 */
  }
}

export interface CodexExecOutput {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * 跑一次 `codex exec`。中止时结束整个子进程组并立刻抛出中止原因，
 * 不用等满 240 秒的超时。
 */
export function runCodexExec(args: string[], prompt: string, signal?: AbortSignal): Promise<CodexExecOutput> {
  signal?.throwIfAborted();
  return new Promise<CodexExecOutput>((resolve, reject) => {
    // 独立进程组：Codex 自己拉起的命令也归我们管，中止时一起结束。
    const codex = spawn("codex", args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forced: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      finish();
    };

    const terminate = () => {
      killTree(codex, "SIGTERM");
      forced = setTimeout(() => killTree(codex, "SIGKILL"), KILL_GRACE_MS);
      forced.unref();
    };

    const onAbort = () => {
      terminate();
      settle(() => reject(signal?.reason ?? new Error("已中止")));
    };

    codex.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    codex.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    codex.stdin.on("error", () => {});
    timeout = setTimeout(terminate, CODEX_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });

    codex.once("error", (error) => {
      settle(() => reject(new Error("无法启动本机 Codex CLI：" + error.message)));
    });

    codex.once("close", (code, termSignal) => {
      settle(() => resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
        signal: termSignal,
      }));
    });

    codex.stdin.end(prompt);
  });
}

export async function summarizeWithCodex(prompt: string, imagePaths: string[] = [], signal?: AbortSignal): Promise<CodexResult> {
  signal?.throwIfAborted();
  const settings = await getCodexRequestSettings();
  const args = buildCodexArgs(imagePaths, settings);
  const { stdout, stderr, code, signal: termSignal } = await runCodexExec(args, prompt, signal);
  signal?.throwIfAborted();
  if (code !== 0) {
    const detail = stderr.trim() || codexErrorFromEvents(stdout);
    throw new Error(detail || `Codex CLI 退出，状态码 ${code ?? termSignal ?? "unknown"}。`);
  }
  return { ...parseCodexResult(stdout), model: settings.model, reasoningEffort: settings.effort };
}
