#!/usr/bin/env node
/**
 * 首屏体积：打开 index.html 时浏览器一定会下载的 JS / CSS（入口脚本、modulepreload、样式表，
 * 以及这些 JS 的静态 import），不含 React.lazy / import() 按需加载的 chunk、字体和图片。
 *
 *   node scripts/perf-budget.mjs [dist 目录]      打印首屏清单与合计（raw / gzip）
 *
 * ui-check 用 firstScreen() 和 perf-budget.json 里的 0.3.4 基线比较：任何一项（JS 或 CSS 的 gzip）
 * 超过基线就失败。基线数字来自 0.3.4 的构建（main@47518a3），见 docs/perf/ui-design-system.md。
 */
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BUDGET_FILE = join(HERE, "perf-budget.json");

export function readBudget() {
  return JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
}

/** 解析 dist/index.html 的首屏资源，并沿 JS 的静态 import 走完依赖图。 */
export function firstScreen(dist) {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const js = new Set();
  const css = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) js.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)) js.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)) css.add(m[1]);

  const queue = [...js];
  while (queue.length) {
    const url = queue.shift();
    const file = join(dist, url);
    if (!existsSync(file)) continue;
    const code = readFileSync(file, "utf8");
    // 只认静态 import：`import{a}from"./x.js"` / `import"./x.js"`；`import("./x.js")` 是按需加载
    for (const m of code.matchAll(/(?:^|[;\s}])import\s*(?:[\w$*{}\s,]+?from\s*)?["'](\.\/[^"']+\.js)["']/g)) {
      const dep = new URL(m[1], "http://x" + url).pathname;
      if (!js.has(dep)) { js.add(dep); queue.push(dep); }
    }
  }

  const measure = (urls) => {
    const files = [...urls].map((url) => {
      const buf = readFileSync(join(dist, url));
      return { url, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
    });
    return { files, raw: files.reduce((n, f) => n + f.raw, 0), gzip: files.reduce((n, f) => n + f.gzip, 0) };
  };
  return { js: measure(js), css: measure(css) };
}

export const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dist = resolve(process.argv[2] || join(HERE, "..", "dist"));
  const r = firstScreen(dist);
  for (const kind of ["js", "css"]) {
    for (const f of r[kind].files) console.log(`${kind.padEnd(4)} ${f.url.padEnd(48)} ${kb(f.raw).padStart(10)}  gzip ${kb(f.gzip).padStart(9)}`);
  }
  console.log(`\n首屏 JS  ${kb(r.js.raw)}（gzip ${kb(r.js.gzip)}）`);
  console.log(`首屏 CSS ${kb(r.css.raw)}（gzip ${kb(r.css.gzip)}）`);
}
