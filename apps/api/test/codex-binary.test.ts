import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import { CHATGPT_APP_CODEX, CodexBinaryError, resolveCodexBinary, rewritesModelArguments } from "../src/codex/binary.ts";

const root = mkdtempSync(join(tmpdir(), "wp-codex-binary-"));
after(() => rmSync(root, { recursive: true, force: true }));

function executable(dir: string, body: string) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "codex");
  writeFileSync(path, body, "utf8");
  chmodSync(path, 0o755);
  return path;
}

const SHIM = `#!/usr/bin/env python3\n# pins model/effort\nEFFORT_KEY = "model_reasoning_effort"\n`;
const OFFICIAL = `#!/bin/sh\nset -eu\nexec "$(dirname "$0")/../CodexCLI.app/Contents/MacOS/codex" "$@"\n`;

test("跳过 PATH 前面会改写模型参数的包装脚本，用后面的真实 Codex", () => {
  const shim = executable(join(root, "a", "shim"), SHIM);
  const real = executable(join(root, "a", "real"), OFFICIAL);
  assert.equal(rewritesModelArguments(shim), true);
  assert.equal(rewritesModelArguments(real), false);
  assert.equal(resolveCodexBinary({ PATH: [join(root, "a", "shim"), join(root, "a", "real")].join(delimiter) }), real);
});

test("WP_CODEX_BIN 显式指定时直接用它；指错了给明确报错", () => {
  const real = executable(join(root, "b", "real"), OFFICIAL);
  assert.equal(resolveCodexBinary({ PATH: "", WP_CODEX_BIN: real }), real);
  assert.throws(() => resolveCodexBinary({ PATH: "", WP_CODEX_BIN: join(root, "b", "missing") }), /WP_CODEX_BIN/);
});

test("只找到包装脚本时报错说明原因，不回落到包装脚本", () => {
  executable(join(root, "c", "shim"), SHIM);
  assert.throws(
    () => resolveCodexBinary({ PATH: join(root, "c", "shim") }, []),
    (error: unknown) => error instanceof CodexBinaryError && /包装脚本/.test(error.message) && /WP_CODEX_BIN/.test(error.message),
  );
});

test("PATH 上只有包装脚本时，退到 ChatGPT.app 自带的 Codex；macOS 默认就查那个位置", () => {
  executable(join(root, "d", "shim"), SHIM);
  const bundled = executable(join(root, "d", "ChatGPT.app"), OFFICIAL);
  assert.equal(resolveCodexBinary({ PATH: join(root, "d", "shim") }, [bundled]), bundled);
  assert.equal(CHATGPT_APP_CODEX, "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex");
});

test("什么都没找到时给明确报错", () => {
  assert.throws(() => resolveCodexBinary({ PATH: join(root, "nothing") }, []), (error: unknown) => error instanceof CodexBinaryError && /没找到本机 Codex CLI/.test(error.message));
});

/**
 * 本机集成检查（不推理）：按大肥鱼的方式解析出来的 codex，带上设置里的 -m / effort 跑 `exec --help`，
 * 打开 ARIS shim 的调试开关；只要经过 shim 它就会在 stderr 打印改写后的命令行。
 */
test("本机真实 Codex：解析结果不是改参数的包装脚本，exec 参数原样到达", { skip: realCodexOrSkip() }, () => {
  const binary = resolveCodexBinary();
  assert.equal(rewritesModelArguments(binary), false);
  const run = spawnSync(binary, ["exec", "--ignore-user-config", "--skip-git-repo-check", "-m", "gpt-wp-chosen", "-c", 'model_reasoning_effort="high"', "--help"], {
    env: { ...process.env, ARIS_CODEX_SHIM_DEBUG: "1" },
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!run.stderr.includes("[codex-shim]"), run.stderr);
});

function realCodexOrSkip(): string | false {
  if (process.env.WP_SKIP_REAL_CODEX === "1") return "WP_SKIP_REAL_CODEX=1";
  try {
    resolveCodexBinary();
    return false;
  } catch (error) {
    return `本机没有可用的真实 Codex：${error instanceof Error ? error.message : String(error)}`;
  }
}
