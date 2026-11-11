import { accessSync, closeSync, constants, openSync, readSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** ChatGPT 桌面版自带的 Codex CLI（官方启动脚本，不改参数）。 */
export const CHATGPT_APP_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex";

export class CodexBinaryError extends Error {}

/**
 * 找本机真实的 Codex CLI，**绕过会改写模型参数的包装脚本**。
 *
 * 有的环境会在 PATH 前面放一个 `codex` 包装脚本（例如 ARIS 的 shim），把 `codex exec` 的
 * `-m` 和 `model_reasoning_effort` 删掉、换成它自己钉死的值。大肥鱼按名字 `spawn("codex")`
 * 就会走到它，设置里选的模型被悄悄换掉。这里只是不用它，不改、不删那个脚本；用户在终端里照旧。
 *
 * 顺序：`WP_CODEX_BIN`（显式指定，原样使用）→ PATH 上的 `codex`（跳过包装脚本）→ ChatGPT.app 自带的 CLI。
 * 只找到包装脚本或什么都没找到时抛 `CodexBinaryError`，不回落到包装脚本。
 */
export function resolveCodexBinary(
  env: Record<string, string | undefined> = process.env,
  bundled: readonly string[] = process.platform === "darwin" ? [CHATGPT_APP_CODEX] : [],
): string {
  const explicit = env.WP_CODEX_BIN?.trim();
  if (explicit) {
    if (!isExecutableFile(explicit)) throw new CodexBinaryError(`WP_CODEX_BIN 指向的 ${explicit} 不存在或不能执行。`);
    return explicit;
  }

  const names = process.platform === "win32" ? ["codex.exe", "codex"] : ["codex"];
  const candidates = (env.PATH ?? "").split(delimiter).filter(Boolean).flatMap((dir) => names.map((name) => join(dir, name)));
  candidates.push(...bundled);

  const skipped: string[] = [];
  for (const candidate of candidates) {
    if (!isExecutableFile(candidate)) continue;
    if (rewritesModelArguments(candidate)) {
      if (!skipped.includes(candidate)) skipped.push(candidate);
      continue;
    }
    return candidate;
  }

  if (skipped.length > 0) {
    throw new CodexBinaryError(
      `找到的 codex（${skipped.join("、")}）是会改写模型参数的包装脚本，大肥鱼不用它；没找到真实的 Codex CLI。请用环境变量 WP_CODEX_BIN 指向真实的 codex。`,
    );
  }
  throw new CodexBinaryError("没找到本机 Codex CLI：请安装 Codex，或用环境变量 WP_CODEX_BIN 指向它。");
}

function isExecutableFile(path: string) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 文本脚本（`#!` 开头）里出现 `model_reasoning_effort`，就当作会改写模型参数的包装脚本。
 * 官方启动脚本（ChatGPT.app 里的 sh、npm 的 codex.js）只转交参数，不会提这个键；
 * 真正的可执行文件不是 `#!` 开头，不在判断范围内。
 */
export function rewritesModelArguments(path: string) {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, length).toString("utf8");
    return text.startsWith("#!") && text.includes("model_reasoning_effort");
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
