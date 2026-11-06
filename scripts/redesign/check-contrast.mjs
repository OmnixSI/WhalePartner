#!/usr/bin/env node
// 设计规范 §4.3 / §12.2 的对比度闸门。
// 用法：node scripts/redesign/check-contrast.mjs
// 退出码：0 全绿；1 有组合低于阈值，或出现规范禁止的用法。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT = join(ROOT, "apps", "client");

function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// 从 CSS 里取自定义属性（只认十六进制值；color-mix 等动态值不参与闸门）
function tokens(css) {
  const out = {};
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const tokensCss = readFileSync(join(CLIENT, "src", "styles", "tokens.css"), "utf8");
const charactersCss = readFileSync(join(CLIENT, "src", "styles", "characters.css"), "utf8");

// tokens.css 里 :root 与 :root[data-theme="dark"] 各取一次
const lightBlock = tokens(tokensCss.split(':root[data-theme="dark"]')[0]);
const darkBlock = tokens(tokensCss.slice(tokensCss.indexOf(':root[data-theme="dark"]')));

const accents = {};
for (const m of charactersCss.matchAll(/:root(?:\[data-theme="dark"\])?\[data-character="([\w-]+)"\]\s*\{\s*--accent:\s*(#[0-9a-fA-F]{6})/g)) {
  const dark = m[0].includes('data-theme="dark"');
  accents[m[1]] = accents[m[1]] || {};
  accents[m[1]][dark ? "dark" : "light"] = m[2];
}

const MIN_BODY = 7.0;   // §0.2-8：正文 ≥7:1
const MIN_TEXT = 4.5;   // 任何文字
const MIN_UI = 3.0;     // 控件边界（非文字）

const failures = [];
const rows = [];

function check(label, fg, bg, min) {
  if (!fg || !bg) { failures.push(`${label}: 颜色缺失（fg=${fg} bg=${bg}）`); return; }
  const r = ratio(fg, bg);
  rows.push([label, fg, bg, r.toFixed(2), r >= min ? "ok" : `FAIL(<${min})`]);
  if (r < min) failures.push(`${label}: ${r.toFixed(2)} < ${min}`);
}

const lightSurfaces = [
  ["paper", lightBlock.paper],
  ["paper-2", lightBlock["paper-2"]],
  ["sheet", lightBlock.sheet],
  ["slip", lightBlock.slip],
];
for (const [name, bg] of lightSurfaces) {
  check(`light ink / ${name}`, lightBlock.ink, bg, MIN_BODY);
  check(`light ink-soft / ${name}`, lightBlock["ink-soft"], bg, MIN_BODY);
  check(`light ink-mute / ${name}`, lightBlock["ink-mute"], bg, MIN_TEXT);
  check(`light alert / ${name}`, lightBlock.alert, bg, MIN_TEXT);
  check(`light ok / ${name}`, lightBlock.ok, bg, MIN_TEXT);
  check(`light lamp-text / ${name}`, lightBlock["lamp-text"], bg, MIN_TEXT);
  for (const [role, pair] of Object.entries(accents)) {
    check(`light accent(${role}) / ${name}`, pair.light, bg, MIN_TEXT);
  }
}

const darkSurfaces = [
  ["paper", darkBlock.paper],
  ["paper-2", darkBlock["paper-2"]],
  ["sheet", darkBlock.sheet],
  ["slip", darkBlock.slip],
];
for (const [name, bg] of darkSurfaces) {
  check(`dark ink / ${name}`, darkBlock.ink, bg, MIN_BODY);
  check(`dark ink-soft / ${name}`, darkBlock["ink-soft"], bg, MIN_BODY);
  check(`dark ink-mute / ${name}`, darkBlock["ink-mute"], bg, MIN_TEXT);
  check(`dark alert / ${name}`, darkBlock.alert, bg, MIN_TEXT);
  check(`dark ok / ${name}`, darkBlock.ok, bg, MIN_TEXT);
  for (const [role, pair] of Object.entries(accents)) {
    check(`dark accent(${role}) / ${name}`, pair.dark, bg, MIN_TEXT);
  }
}

// 实心强调色上的字
for (const [role, pair] of Object.entries(accents)) {
  check(`light accent-ink on accent(${role})`, lightBlock["accent-ink"], pair.light, MIN_TEXT);
  check(`dark accent-ink on accent(${role})`, darkBlock["accent-ink"], pair.dark, MIN_TEXT);
}
check("light alert-ink on alert", lightBlock["alert-ink"], lightBlock.alert, MIN_TEXT);
check("dark alert-ink on alert", darkBlock["alert-ink"], darkBlock.alert, MIN_TEXT);

// 控件边界（非文字，≥3:1）
check("light line-strong / paper", lightBlock["line-strong"], lightBlock.paper, MIN_UI);
check("light line-strong / sheet", lightBlock["line-strong"], lightBlock.sheet, MIN_UI);
check("dark line-strong / paper", darkBlock["line-strong"], darkBlock.paper, MIN_UI);
check("dark line-strong / sheet", darkBlock["line-strong"], darkBlock.sheet, MIN_UI);

// 珊瑚色只能做装饰：不得作为文字色出现（§0.2-2）
const banned = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(css|tsx|ts)$/.test(name)) continue;
    let text = readFileSync(p, "utf8");
    // CSS 注释里会说「禁止 gradient」——别把规范注释当成违规
    if (p.endsWith(".css")) text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const rel = p.slice(ROOT.length + 1);
    if (/color\s*:\s*var\(--coral\)/.test(text)) banned.push(`${rel}: color: var(--coral) —— 珊瑚色禁止做文字`);
    if (/gradient\(|backdrop-filter/.test(text)) banned.push(`${rel}: 出现 gradient/backdrop-filter`);
  }
}
walk(join(CLIENT, "src"));

const pad = (s, n) => String(s).padEnd(n);
const width = Math.max(...rows.map((r) => r[0].length));
for (const r of rows) console.log(`${pad(r[0], width)}  ${r[1]} on ${r[2]}  ${pad(r[3], 6)} ${r[4]}`);

if (banned.length) {
  console.log("\n禁止的用法：");
  for (const b of banned) console.log("  - " + b);
}
const bad = failures.length + banned.length;
console.log(`\n${rows.length} 组组合，${bad} 处问题。`);
process.exit(bad === 0 ? 0 : 1);
