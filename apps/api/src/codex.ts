import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { listCodexModels, resolveCodexSettings } from "./codex-app-server.ts";
import { readStoredCodexSettings, type StoredCodexSettings } from "./codex-settings.ts";

const CODEX_TIMEOUT_MS = 240000;

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

export async function summarizeWithCodex(prompt: string, imagePaths: string[] = []): Promise<CodexResult> {
  const settings = await getCodexRequestSettings();
  const args = buildCodexArgs(imagePaths, settings);

  const result = await new Promise<CodexResult>((resolve, reject) => {
    const codex = spawn("codex", args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timeout: NodeJS.Timeout;

    codex.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    codex.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    codex.stdin.on("error", () => {});
    timeout = setTimeout(() => codex.kill("SIGTERM"), CODEX_TIMEOUT_MS);

    codex.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error("无法启动本机 Codex CLI：" + error.message));
    });

    codex.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim() || codexErrorFromEvents(Buffer.concat(stdout).toString("utf8"));
        reject(new Error(detail || `Codex CLI 退出，状态码 ${code ?? signal ?? "unknown"}。`));
        return;
      }

      try {
        resolve(parseCodexResult(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });

    codex.stdin.end(prompt);
  });
  return { ...result, model: settings.model, reasoningEffort: settings.effort };
}
