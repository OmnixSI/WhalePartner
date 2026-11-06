// 首屏字体子集（规范 §4.5）：把 lxgw-wenkai-webfont 的每个 unicode-range 分片
// 再裁一次，只保留本项目源码里真正出现的字；首屏传输因此从 ~550KB 降到几十 KB。
// 依赖 pyftsubset（fontTools + brotli）。产物在 public/fonts/core/，CSS 由本脚本生成。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
const SRC = join(pkg, "src");
const PKG_DIR = join(pkg, "node_modules", "lxgw-wenkai-webfont");
const OUT = join(pkg, "public", "fonts", "core");
const TMP = join(pkg, ".font-build");

// 1) 收集源码里出现的字
const chars = new Set();
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (![".tsx", ".ts", ".css", ".html"].includes(extname(name))) continue;
    for (const ch of readFileSync(p, "utf8")) if (ch.codePointAt(0) > 0x2000) chars.add(ch);
  }
})(SRC);
writeFileSync(join(here, "characters.txt"), [...chars].join(""));

// 2) 解析 @font-face，按 unicode-range 求交集
const rangeToChars = (spec) => {
  const out = [];
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?$/);
    if (!m) continue;
    const start = parseInt(m[1].replace(/\?/g, "0"), 16);
    const end = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, "F"), 16);
    for (const ch of chars) {
      const cp = ch.codePointAt(0);
      if (cp >= start && cp <= end) out.push(ch);
    }
  }
  return out;
};

mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let kept = 0, totalBytes = 0;
const faces = [];
for (const weight of ["regular", "bold"]) {
  const css = readFileSync(join(PKG_DIR, `lxgwwenkai-${weight}.css`), "utf8");
  const blocks = css.split("@font-face").slice(1);
  for (const block of blocks) {
    const url = block.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
    const range = block.match(/unicode-range:\s*([^;}]+)/)?.[1];
    const family = block.match(/font-family:\s*["']?([^;"']+)/)?.[1];
    if (!url || !range) continue;
    const hit = [...new Set(rangeToChars(range))];
    if (hit.length === 0) continue;
    const srcFile = url.startsWith("/") || url.startsWith("http")
      ? null : join(PKG_DIR, url.replace(/^\.\//, ""));
    if (!srcFile) continue;
    const name = `${weight}-${String(kept).padStart(3, "0")}.woff2`;
    const outFile = join(OUT, name);
    const textFile = join(TMP, `${weight}-${kept}.txt`);
    writeFileSync(textFile, hit.join(""));
    try {
      execFileSync("pyftsubset", [srcFile, `--text-file=${textFile}`, "--flavor=woff2", "--layout-features=*", `--output-file=${outFile}`], { stdio: "ignore" });
    } catch (e) { console.error('subset fail', name, String(e.message).split('\n').slice(0,3).join(' | ')); continue; }
    const size = statSync(outFile).size;
    totalBytes += size; kept += 1;
    faces.push({ family: family || "LXGW WenKai", weight: weight === "bold" ? 700 : 400, url: `/fonts/core/${name}`, range, size });
  }
}

const cssOut = faces.map((f) => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url("${f.url}") format("woff2");unicode-range:${f.range};}`).join("\n");
writeFileSync(join(pkg, "src", "styles", "fonts-core.css"), cssOut + "\n");
console.log(`分片 ${kept} 个，合计 ${(totalBytes / 1024).toFixed(1)} KB（源码字符 ${chars.size}）`);
