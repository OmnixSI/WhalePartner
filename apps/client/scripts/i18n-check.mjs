#!/usr/bin/env node
/**
 * 中英文案检查（`pnpm --dir apps/client run i18n:check`）：
 *
 * 1. 键对齐：前端 `src/i18n/locales/{zh,en}` 和后端 `apps/api/src/i18n/{zh,en}.ts`
 *    两份文案的键必须一一对应，同一个键要么都是字符串、要么都是参数个数相同的函数，且不能是空串。
 * 2. 硬编码中文：扫描前端源码、桌面壳 Rust 源码和后端源码，去掉注释后还剩中文的行都算漏网。
 *    下面 IGNORE_FILES 列的是不面向用户的文件（附原因）；文件里个别不面向用户的段落用
 *    `i18n-ignore-start` / `i18n-ignore-end` 注释包起来，单行用行尾 `i18n-ignore` 注释。
 *    日志（console.* / log::*）整行跳过。
 *
 * 有问题时退出码为 1，并逐条列出位置。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const problems = [];

/* ---------------------------------------------------------------- 1. 键对齐 */

function compare(zh, en, path, where) {
  const zk = Object.keys(zh);
  const ek = new Set(Object.keys(en));
  for (const key of zk) {
    const p = path ? `${path}.${key}` : key;
    if (!ek.has(key)) { problems.push(`${where}: 英文缺少键 ${p}`); continue; }
    ek.delete(key);
    const a = zh[key];
    const b = en[key];
    if (typeof a !== typeof b) problems.push(`${where}: ${p} 类型不一致（zh ${typeof a} / en ${typeof b}）`);
    else if (typeof a === "function" && a.length !== b.length) problems.push(`${where}: ${p} 参数个数不一致（zh ${a.length} / en ${b.length}）`);
    else if (typeof a === "string" && (!a.trim() || !b.trim())) problems.push(`${where}: ${p} 有空文案`);
    else if (Array.isArray(a) && a.length !== b.length) problems.push(`${where}: ${p} 数组长度不一致（zh ${a.length} / en ${b.length}）`);
    else if (a && typeof a === "object") compare(a, b, p, where);
  }
  for (const key of ek) problems.push(`${where}: 英文多出键 ${path ? `${path}.${key}` : key}`);
}

const client = join(repo, "apps/client/src/i18n/locales");
const api = join(repo, "apps/api/src/i18n");
const { zh: clientZh } = await import(join(client, "zh/index.ts"));
const { en: clientEn } = await import(join(client, "en/index.ts"));
compare(clientZh, clientEn, "", "前端文案");
const { zh: apiZh } = await import(join(api, "zh.ts"));
const { en: apiEn } = await import(join(api, "en.ts"));
compare(apiZh, apiEn, "", "后端文案");

function countKeys(obj) {
  return Object.values(obj).reduce((n, v) => n + (v && typeof v === "object" && !Array.isArray(v) ? countKeys(v) : 1), 0);
}

/* ---------------------------------------------------------------- 2. 硬编码中文 */

const CJK = /[㐀-鿿！-～　-〿]/;

/** 不面向用户的文件/目录（相对仓库根），以及原因。 */
const IGNORE_FILES = [
  // 文案本身
  ["apps/client/src/i18n/locales/zh/", "中文文案"],
  ["apps/client/src/i18n/locales/en/", "英文文案（含「简体中文」选项名）"],
  ["apps/api/src/i18n/zh-parts/", "中文文案"],
  // 隐藏的开发预览页：只在 /__kit 与 character-cards.html 打开，不在产品导航里
  ["apps/client/src/pages/UiKitPage.tsx", "开发预览页 /__kit"],
  ["apps/client/src/pages/KitPage.tsx", "开发预览页 /__kit/ink"],
  ["apps/client/src/pages/CardKitPage.tsx", "开发预览页 /__kit/cards"],
  ["apps/client/src/card-preview/CardPreviewPage.tsx", "开发预览页 character-cards.html"],
  ["apps/client/src/card-preview/CardShowcase.tsx", "开发预览页 character-cards.html"],
  // 后端：给开发者的命令行与开发服务器
  ["apps/api/src/cli.ts", "开发者命令行（pnpm login/summarize 等）"],
  ["apps/api/src/dev-server.ts", "开发用服务器"],
  ["apps/api/src/llm-ping.ts", "开发者连通性自检"],
  ["apps/api/src/voice/assets/", "语音模型资源"],
];
const EXTRA_IGNORE = (process.env.I18N_IGNORE_EXTRA ?? "").split(",").filter(Boolean);

function ignored(rel) {
  return [...IGNORE_FILES.map(([p]) => p), ...EXTRA_IGNORE].some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));
}

/** 把注释替换成空格（保留换行），字符串原样留下。`'`/`"` 字符串不跨行；Rust 不把 `'` 当字符串。 */
function stripComments(src, rust) {
  let out = "";
  let state = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (state === "code") {
      // 正则里的 `\/` 别和后面的 `/` 凑成 `//`
      if (c === "\\") { out += c + (n ?? ""); i++; continue; }
      if (c === "/" && n === "/") { state = "line"; out += "  "; i++; continue; }
      if (c === "/" && n === "*") { state = "block"; out += "  "; i++; continue; }
      if (c === '"' || c === "`" || (c === "'" && !rust)) state = c;
      out += c;
    } else if (state === "line") {
      if (c === "\n") { state = "code"; out += c; } else out += " ";
    } else if (state === "block") {
      if (c === "*" && n === "/") { state = "code"; out += "  "; i++; }
      else out += c === "\n" ? c : " ";
    } else {
      if (c === "\\") { out += c + (n ?? ""); i++; continue; }
      if (c === "\n" && state !== "`") state = "code";
      else if (c === state) state = "code";
      out += c;
    }
  }
  return out;
}

function scanFile(abs) {
  const rel = relative(repo, abs);
  if (ignored(rel)) return;
  const raw = readFileSync(abs, "utf8");
  if (!CJK.test(raw)) return;
  const rawLines = raw.split("\n");
  const lines = stripComments(raw, abs.endsWith(".rs")).split("\n");
  let skipping = false;
  lines.forEach((line, index) => {
    const original = rawLines[index];
    if (/i18n-ignore-start/.test(original)) { skipping = true; return; }
    if (/i18n-ignore-end/.test(original)) { skipping = false; return; }
    if (skipping || /i18n-ignore\b/.test(original)) return;
    if (!CJK.test(line)) return;
    if (/\b(console\.(log|info|warn|error|debug)|log::(info|warn|error|debug)!|logger\.|log\(|writeln!\(log)/.test(line)) return;
    problems.push(`${rel}:${index + 1}: ${original.trim().slice(0, 160)}`);
  });
}

function walk(dir, exts) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, exts);
    else if (exts.some((ext) => name.endsWith(ext))) scanFile(abs);
  }
}

walk(join(repo, "apps/client/src"), [".ts", ".tsx"]);
walk(join(repo, "apps/client/src-tauri/src"), [".rs"]);
walk(join(repo, "apps/api/src"), [".ts"]);

if (problems.length) {
  console.error(`i18n 检查没通过（${problems.length} 处）：`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`i18n 检查通过：前端 ${countKeys(clientZh)} 条、后端 ${countKeys(apiZh)} 条中英文案键一一对应；源码里没有未翻译的中文。`);
