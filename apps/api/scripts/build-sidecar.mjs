#!/usr/bin/env node
/**
 * 把后端打成桌面 App 的 sidecar。
 *
 *   node scripts/build-sidecar.mjs          完整构建（tauri build 前跑）
 *   node scripts/build-sidecar.mjs --dev    只放 Node 可执行文件和空目录（tauri dev 前跑，几百毫秒）
 *   --ignore-scripts                        npm install 不跑安装脚本（受限网络下验证流程用）
 *   --target <triple>                       目标三元组，默认本机（也读 TAURI_ENV_TARGET_TRIPLE）
 *
 * 产物（都在 apps/client/src-tauri 下，已 gitignore）：
 *   binaries/whale-node-<triple>[.exe]   Tauri externalBin：Node 可执行文件（取自本机 process.execPath）
 *   sidecar/api/dist/server.mjs          esbuild 打出的单文件 ESM
 *   sidecar/api/dist/{rules.md,style.md,characters,prompts}   运行时按相对路径读取的文本
 *   sidecar/api/vendor                   vendor 资源
 *   sidecar/api/node_modules             原生/动态依赖（onnxruntime-node 等），npm 安装
 *   sidecar/bin/ffmpeg[.exe]             ffmpeg（ffmpeg-static，没有则取 PATH 里的）
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const apiDir = resolve(import.meta.dirname, "..");
const tauriDir = resolve(apiDir, "../client/src-tauri");
const binariesDir = join(tauriDir, "binaries");
const sidecarDir = join(tauriDir, "sidecar");
const dev = process.argv.includes("--dev");

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const m = /^host:\s*(\S+)/m.exec(out);
  if (!m) throw new Error("读不到 rustc 的 host 三元组。");
  return m[1];
}

const triple = argValue("--target") ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple();
const exe = triple.includes("windows") ? ".exe" : "";
const log = (...a) => console.log("[build-sidecar]", ...a);

/* ---- 1. Node 可执行文件 ---- */
mkdirSync(binariesDir, { recursive: true });
const nodeTarget = join(binariesDir, `whale-node-${triple}${exe}`);
if (!existsSync(nodeTarget) || readFileSync(nodeTarget).length !== readFileSync(process.execPath).length) {
  if (!dev && Number(process.versions.node.split(".")[0]) !== 26) {
    console.warn(`[build-sidecar] 警告：当前 Node 是 v${process.versions.node}，仓库要求 26。打进包里的就是这个版本。`);
  }
  copyFileSync(process.execPath, nodeTarget);
  chmodSync(nodeTarget, 0o755);
  log("Node ->", nodeTarget);
}

// Tauri 在编译期检查 resources 目录存在。
mkdirSync(join(sidecarDir, "api"), { recursive: true });
mkdirSync(join(sidecarDir, "bin"), { recursive: true });

if (dev) {
  log("--dev：跳过 esbuild / 依赖 / ffmpeg。");
  process.exit(0);
}

/* ---- 2. esbuild 单文件 ---- */
const require = createRequire(join(apiDir, "package.json"));
const esbuild = require("esbuild");
const pkg = JSON.parse(readFileSync(join(apiDir, "package.json"), "utf8"));
// 不进 bundle、改为随包安装 node_modules 的依赖：带原生二进制或动态 require 的那几个。
const externals = ["@huggingface/transformers", "mem0ai", "playwright-core", "ws", "onnxruntime-node", "onnxruntime-web", "sharp", "better-sqlite3"];

rmSync(join(sidecarDir, "api"), { recursive: true, force: true });
const distDir = join(sidecarDir, "api", "dist");
mkdirSync(distDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(apiDir, "src/server.ts")],
  outfile: join(distDir, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  external: [...externals, "mem0ai/*", "@huggingface/transformers/*"],
  sourcemap: "linked",
  logLevel: "info",
  // 打进来的 CJS 依赖偶尔用 require / __dirname。
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
});
log("server.mjs 完成");

/* ---- 3. 运行时读取的文本和 vendor ---- */
cpSync(join(apiDir, "src/persona/rules.md"), join(distDir, "rules.md"));
cpSync(join(apiDir, "src/persona/style.md"), join(distDir, "style.md"));
cpSync(join(apiDir, "src/persona/characters"), join(distDir, "characters"), { recursive: true });
cpSync(join(apiDir, "src/prompts"), join(distDir, "prompts"), { recursive: true });
cpSync(join(apiDir, "src/voice/xasr_worker.py"), join(distDir, "xasr_worker.py"));
cpSync(join(apiDir, "src/voice/assets"), join(distDir, "voice/assets"), { recursive: true });
cpSync(join(apiDir, "src/voice/tts_worker.py"), join(distDir, "voice/tts_worker.py"));
mkdirSync(join(sidecarDir, "api/scripts"), { recursive: true });
cpSync(join(apiDir, "scripts/setup-cosyvoice3-runtime.sh"), join(sidecarDir, "api/scripts/setup-cosyvoice3-runtime.sh"));
cpSync(join(apiDir, "scripts/cosyvoice-requirements.txt"), join(sidecarDir, "api/scripts/cosyvoice-requirements.txt"));
cpSync(join(apiDir, "scripts/prepare-cosyvoice3-model.py"), join(sidecarDir, "api/scripts/prepare-cosyvoice3-model.py"));
cpSync(join(apiDir, "scripts/setup-xasr-runtime.sh"), join(sidecarDir, "api/scripts/setup-xasr-runtime.sh"));
cpSync(join(apiDir, "vendor"), join(sidecarDir, "api/vendor"), { recursive: true });

/* ---- 4. X-ASR native Python worker ---- */
if (process.platform === "darwin") {
  const dataDirectory = process.env.WP_DATA_DIR || join(homedir(), "Library", "Application Support", "com.omnixsi.whalepartner");
  const python = process.env.WP_XASR_PYTHON || join(dataDirectory, "runtimes", "asr-sherpa", "bin", "python");
  let runtimeReady = existsSync(python);
  if (runtimeReady) {
    try { execFileSync(python, ["-c", "import PyInstaller, numpy, sherpa_onnx"], { stdio: "ignore" }); }
    catch { runtimeReady = false; }
  }
  if (!runtimeReady) {
    execFileSync("bash", [join(apiDir, "scripts/setup-xasr-runtime.sh")], { stdio: "inherit" });
  }
  const resolvedPython = existsSync(python) ? python : join(dataDirectory, "runtimes", "asr-sherpa", "bin", "python");
  const xasrBuildDir = join(sidecarDir, ".xasr-build");
  mkdirSync(xasrBuildDir, { recursive: true });
  execFileSync(resolvedPython, ["-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--collect-all", "sherpa_onnx", "--collect-all", "sherpa_onnx_core", "--name", "whale-xasr-worker",
    "--distpath", join(sidecarDir, "bin"), "--workpath", join(xasrBuildDir, "work"), "--specpath", xasrBuildDir,
    join(apiDir, "src/voice/xasr_worker.py")], { stdio: "inherit" });
  chmodSync(join(sidecarDir, "bin", "whale-xasr-worker"), 0o755);
  log("X-ASR 本机推理运行时已打包");
}

/* ---- 5. 外置依赖（含 onnxruntime-node 原生库）---- */
const deps = {};
for (const name of ["@huggingface/transformers", "mem0ai", "playwright-core", "ws"]) {
  const v = pkg.dependencies?.[name];
  if (!v) throw new Error(`apps/api/package.json 里没有 ${name}。`);
  deps[name] = v;
}
const apiOut = join(sidecarDir, "api");
writeFileSync(join(apiOut, "package.json"), JSON.stringify({ name: "whale-api-runtime", private: true, type: "module", dependencies: deps }, null, 2));
log("npm install（外置依赖）…");
// --ignore-scripts：只在拿不到 onnxruntime-node 原生库下载源的受限网络里用，包里不会有可用的向量模型运行时。
const npmArgs = ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"];
if (process.argv.includes("--ignore-scripts") || process.env.WP_SIDECAR_IGNORE_SCRIPTS === "1") npmArgs.push("--ignore-scripts");
execFileSync("npm", npmArgs, {
  cwd: apiOut,
  stdio: "inherit",
  shell: process.platform === "win32",
});

/* ---- 6. ffmpeg ---- */
let ffmpeg;
try {
  const p = createRequire(join(apiDir, "package.json"))("ffmpeg-static");
  if (typeof p === "string" && existsSync(p)) ffmpeg = p;
} catch {}
if (!ffmpeg) {
  try {
    const found = execFileSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
    if (found) ffmpeg = found;
  } catch {}
}
if (ffmpeg) {
  const dest = join(sidecarDir, "bin", `ffmpeg${exe}`);
  copyFileSync(ffmpeg, dest);
  chmodSync(dest, 0o755);
  log("ffmpeg ->", dest, `(来自 ${ffmpeg})`);
} else {
  console.warn("[build-sidecar] 警告：找不到 ffmpeg（ffmpeg-static 没下到、PATH 里也没有），包里不带 ffmpeg，视频抽帧会失败。");
  writeFileSync(join(sidecarDir, "bin", ".keep"), "");
}
log("完成。");
