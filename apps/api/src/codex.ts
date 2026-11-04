import { spawn } from "node:child_process";

const CODEX_TIMEOUT_MS = 240000;

export function parseCodexMessage(output: string) {
  let message = "";
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;

    let event: { type?: string; item?: { type?: string; text?: string } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      message = event.item.text ?? "";
    }
  }

  if (!message.trim()) throw new Error("Codex 没有返回摘要文本。");
  return message;
}

export async function summarizeWithCodex(prompt: string) {
  const args = [
    "exec",
    "--ephemeral",
    "--json",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "-C",
    "/private/tmp",
    "-m",
    "gpt-6-luna",
    "-c",
    'model_reasoning_effort="minimal"',
    "-",
  ];

  return new Promise<string>((resolve, reject) => {
    const codex = spawn("codex", args, { cwd: "/private/tmp", stdio: ["pipe", "pipe", "pipe"] });
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
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(detail || `Codex CLI 退出，状态码 ${code ?? signal ?? "unknown"}。`));
        return;
      }

      try {
        resolve(parseCodexMessage(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });

    codex.stdin.end(prompt);
  });
}
