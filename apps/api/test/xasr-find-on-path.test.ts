import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findOnPath } from "../src/voice/asr.ts";

// 回归（#120 初审第 3 项）：onedir 布局下 PATH 里可能有同名目录 `bin/whale-xasr-worker/`，
// 返回它会让 spawn 报 EACCES，并跳过 Python 回退。只能返回可执行的普通文件。
test("findOnPath 跳过同名目录和不可执行文件，返回后面真正可执行的那个", () => {
  const root = mkdtempSync(join(tmpdir(), "wp-find-on-path-"));
  const savedPath = process.env.PATH;
  try {
    const dirFirst = join(root, "a");
    mkdirSync(join(dirFirst, "whale-xasr-worker"), { recursive: true });
    const notExecutable = join(root, "b");
    mkdirSync(notExecutable);
    writeFileSync(join(notExecutable, "whale-xasr-worker"), "#!/bin/sh\n");
    chmodSync(join(notExecutable, "whale-xasr-worker"), 0o644);
    const real = join(root, "c");
    mkdirSync(real);
    writeFileSync(join(real, "whale-xasr-worker"), "#!/bin/sh\n");
    chmodSync(join(real, "whale-xasr-worker"), 0o755);

    process.env.PATH = [dirFirst, notExecutable, real].join(":");
    assert.equal(findOnPath("whale-xasr-worker"), join(real, "whale-xasr-worker"));
    process.env.PATH = [dirFirst, notExecutable].join(":");
    assert.equal(findOnPath("whale-xasr-worker"), null);
  } finally {
    process.env.PATH = savedPath;
    rmSync(root, { recursive: true, force: true });
  }
});
