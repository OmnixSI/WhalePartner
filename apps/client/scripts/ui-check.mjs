#!/usr/bin/env node
/**
 * 界面验收 · 一条命令跑完全部机器检查（docs/UI_SPEC.md §12.2 / §12.3）。
 *
 *   pnpm --dir apps/client run ui:check                    全跑（会自己起 vite dev，跑完关掉）
 *   pnpm --dir apps/client run ui:check --static           只跑源码检查，不开浏览器
 *   pnpm --dir apps/client run ui:check --shots            另外拍 6 页 × 亮/暗和预览页，存到 apps/client/test-results/ui-check/
 *   pnpm --dir apps/client run ui:check --base=http://127.0.0.1:1420   复用已在跑的 dev server
 *   pnpm --dir apps/client run ui:check --debt             打印各文件的动效 / filter 存量（JSON），用来调低 perf-budget.json
 *
 * 检查项：
 *   1  对比度（亮/暗 × 4 角色 × 正文/语义层，复用 contrast-check.mjs）
 *   2  淘汰 token（ink-faint / --rule / --ground / --radius / --font-serif / --sea / --ease / --chat-w）
 *   3  gradient / backdrop-filter
 *   4  window.confirm / window.alert
 *   5  珊瑚色作文字
 *   6  圆角只允许 var(--r-*) / 50% / 0
 *   7  动效参数只在 tokens（CSS 无字面时长、TSX 无手写弹簧）
 *   8  触控目标 ≥44px（老人模式 ≥56px）
 *   9  横向滚动 ≤ 视口（380px 与 --scale=2）
 *  10  axe wcag2a/2aa/21aa/22aa，critical + serious = 0
 *
 * 性能预算（docs/DESIGN.md §性能预算，基线在 scripts/perf-budget.json）：
 *  11  运行时依赖只允许清单里的包（不加 UI 库 / 动画库 / CSS-in-JS）
 *  12  动画与过渡只动 transform / opacity；components/ui 必须 0 处，旧页面按文件只减不增
 *  13  filter 按文件只减不增（backdrop-filter 由第 3 项拦）
 *  14  首屏 JS / CSS gzip 不超过 0.3.4（默认构建到 node_modules/.cache/ui-check-dist，--dist=… 复用现成构建）
 *  15  每页静置 9.5 秒后没有还在跑的循环动画（加载转圈只在 /__kit 豁免）；页面隐藏后没有任何还在跑的动画
 *  16  懒加载页借用的组件样式还在（/surf 的便签是 fixed 小条），标签的 aria-controls 不悬空、渲染的面板都有标签指向
 *  （--shots 再加一项：截图）
 *
 * 退出码：0 全绿；1 有失败。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "./browser.mjs";
import { stubApi } from "./ui-fixtures.mjs";
import { firstScreen, kb, readBudget } from "./perf-budget.mjs";
import { instrumentTimers, runningAnimations } from "./perf-idle.mjs";
import { contrastRows, isCardStyleException, scanBannedUsage, stripComments } from "./contrast-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..");
const ROOT = join(CLIENT, "..", "..");
const SRC = join(CLIENT, "src");
const SHOTS = join(CLIENT, "test-results", "ui-check");

const argv = process.argv.slice(2);
const STATIC_ONLY = argv.includes("--static");
const WITH_SHOTS = argv.includes("--shots");
const BASE = (argv.find((a) => a.startsWith("--base="))?.slice(7) || process.env.WP_BASE || "http://127.0.0.1:1420").replace(/\/$/, "");
const PORT = new URL(BASE).port || "1420";
const DIST_ARG = argv.find((a) => a.startsWith("--dist="))?.slice(7);

const results = [];
function record(name, ok, detail = "") {
  const entry = { name, ok, detail };
  results.push(entry);
  return entry;
}
const rel = (p) => relative(ROOT, p);

// ---------- 工具：遍历源码 ----------
function sourceFiles(exts = /\.(css|tsx?)$/) {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (exts.test(name)) out.push(p);
    }
  })(SRC);
  return out;
}

// ---------- 1. 对比度 ----------
function checkContrast() {
  const { rows, failures } = contrastRows();
  return record(`对比度 ${rows.length} 组（亮/暗 × 4 角色）`, failures.length === 0, failures.length ? failures.join("；") : `${rows.length} 组全部达标`);
}

// ---------- 2. 淘汰 token ----------
const OBSOLETE = /ink-faint|--rule\b|--ground|--radius|--font-serif|--chat-w|var\(--sea\)|var\(--ease\)|var\(--ground-2\)/;
function checkObsoleteTokens() {
  const hits = [];
  for (const p of sourceFiles()) {
    const text = readFileSync(p, "utf8");
    text.split("\n").forEach((line, i) => {
      const m = OBSOLETE.exec(line);
      if (m) hits.push(`${rel(p)}:${i + 1} ${m[0]}`);
    });
  }
  return record("淘汰 token（P0 兼容别名）", hits.length === 0, hits.length ? hits.slice(0, 12).join("；") : "0 处");
}

// ---------- 3/5. 禁用样式 + 珊瑚色作文字（与 contrast-check.mjs 同一份实现） ----------
function checkBannedUsage() {
  const banned = scanBannedUsage();
  const gradient = banned.filter((b) => b.includes("gradient"));
  const coral = banned.filter((b) => b.includes("珊瑚"));
  record("gradient / backdrop-filter", gradient.length === 0, gradient.length ? gradient.slice(0, 8).join("；") : "0 处");
  record("珊瑚色作文字", coral.length === 0, coral.length ? coral.slice(0, 8).join("；") : "0 处");
}

// ---------- 4. window.confirm / alert ----------
function checkNativeDialogs() {
  const hits = [];
  for (const p of sourceFiles()) {
    const code = stripComments(readFileSync(p, "utf8"));
    code.split("\n").forEach((line, i) => {
      if (/(?<![\w$.])(?:window\s*\.\s*)?(?:confirm|alert|prompt)\s*\(/.test(line)) hits.push(`${rel(p)}:${i + 1} ${line.trim().slice(0, 70)}`);
    });
  }
  return record("window.confirm / alert", hits.length === 0, hits.length ? hits.slice(0, 8).join("；") : "0 处");
}

// ---------- 6. 圆角只允许 token / 50% / 0 ----------
const RADIUS_OK = /^(var\(--r-[\w-]+\)|0|50%|inherit)$/; // inherit：叠层与父元素同形
function checkRadius() {
  const hits = [];
  for (const p of sourceFiles()) {
    if (isCardStyleException(p)) continue;
    const code = stripComments(readFileSync(p, "utf8"));
    const isCss = p.endsWith(".css");
    // CSS：border-radius / 各角写法；TSX：只认字符串字面量（radiusToken() 走 tokens，不拦）
    const re = isCss
      ? /border(?:-(?:top|bottom|left|right))?(?:-(?:left|right))?-radius\s*:\s*([^;}]+)/g
      : /borderRadius\s*:\s*["']([^"']+)["']/g;
    for (const m of code.matchAll(re)) {
      const values = m[1].split(/[\s/]+/).filter(Boolean);
      for (const v of values) {
        if (!RADIUS_OK.test(v) && v !== "var(--r-round)") hits.push(`${rel(p)}: border-radius: ${m[1].trim().slice(0, 40)}`);
      }
    }
  }
  return record("圆角只允许 var(--r-*) / 50% / 0", hits.length === 0, hits.length ? hits.slice(0, 12).join("；") : "0 处");
}

// ---------- 7. 动效参数只在 tokens ----------
function checkMotionTokens() {
  const hits = [];
  for (const p of sourceFiles()) {
    if (isCardStyleException(p)) continue;
    const code = stripComments(readFileSync(p, "utf8"));
    if (p.endsWith(".css")) {
      for (const m of code.matchAll(/(?:transition|animation)(?:-duration|-delay)?\s*:\s*([^;}]+)/g)) {
        if (/(?<![\w-])\d+(?:\.\d+)?m?s\b/.test(m[1])) hits.push(`${rel(p)}: ${m[1].trim().slice(0, 60)}`);
      }
    } else if (!p.includes("/motion/tokens.ts")) {
      for (const m of code.matchAll(/stiffness\s*:\s*[\d.]+|damping\s*:\s*[\d.]+|type\s*:\s*["']spring["']|duration\s*:\s*(?!0\b)[\d.]+/g)) {
        hits.push(`${rel(p)}: ${m[0]}`);
      }
    }
  }
  return record("动效参数只在 tokens（无手写时长/曲线/弹簧）", hits.length === 0, hits.length ? hits.slice(0, 12).join("；") : "0 处");
}


// ---------- 11–14. 性能预算 ----------
const BUDGET = existsSync(join(HERE, "perf-budget.json")) ? readBudget() : { motionDebt: {}, filterDebt: {}, runtimeDependencies: [] };

function checkRuntimeDeps() {
  const pkg = JSON.parse(readFileSync(join(CLIENT, "package.json"), "utf8"));
  const extra = Object.keys(pkg.dependencies ?? {}).filter((d) => !BUDGET.runtimeDependencies.includes(d));
  return record("运行时依赖在清单内（perf-budget.json）", extra.length === 0, extra.length ? `新增 ${extra.join("、")}：先在 #151 说明体积与必要性，再改清单` : `${Object.keys(pkg.dependencies ?? {}).length} 个`);
}

/** 顶层逗号切分（cubic-bezier(…, …) 里的逗号不算）。 */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COMPOSITED = new Set(["transform", "opacity", "translate", "scale", "rotate", "visibility", "none", "animation-timing-function", "offset"]);
/** 每个 CSS 文件里不走合成层的动效：@keyframes 里的属性、transition 的属性。 */
export function scanMotionDebt() {
  const motion = {};
  const filter = {};
  for (const p of sourceFiles(/\.css$/)) {
    const css = stripComments(readFileSync(p, "utf8"));
    const key = relative(CLIENT, p);
    const bad = [];
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)) {
      const props = [...new Set([...m[2].matchAll(/([\w-]+)\s*:/g)].map((x) => x[1]))].filter((x) => !COMPOSITED.has(x) && !x.startsWith("--"));
      if (props.length) bad.push(`@keyframes ${m[1]}: ${props.join(",")}`);
    }
    for (const m of css.matchAll(/(?<![\w-])transition(-property)?\s*:\s*([^;}]+)/g)) {
      const props = splitTop(m[2]).map((part) => (m[1] ? part : part.split(/\s+/)[0]));
      const off = props.filter((x) => x && !COMPOSITED.has(x) && !x.startsWith("var("));
      if (off.length) bad.push(`transition: ${off.join(",")}`);
    }
    if (bad.length) motion[key] = bad;
    const filters = [...css.matchAll(/(?<![\w-])filter\s*:\s*([^;}]+)/g)].filter((m) => m[1].trim() !== "none");
    if (filters.length) filter[key] = filters.length;
  }
  return { motion, filter };
}

function ratchet(name, found, allowed, strictPrefix) {
  const over = [];
  const lower = [];
  for (const [file, n] of Object.entries(found)) {
    const cap = file.startsWith(strictPrefix) ? 0 : (allowed[file] ?? 0);
    if (n > cap) over.push(`${file} ${n} > ${cap}`);
  }
  for (const [file, cap] of Object.entries(allowed)) {
    if ((found[file] ?? 0) < cap) lower.push(`${file} ${found[file] ?? 0}`);
  }
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  const detail = over.length ? over.join("；") : `旧页面存量 ${total} 处${lower.length ? `；已减少，可把基线降到：${lower.join("、")}` : ""}`;
  return record(name, over.length === 0, detail);
}

function checkMotionDebt() {
  const { motion, filter } = scanMotionDebt();
  const counts = Object.fromEntries(Object.entries(motion).map(([f, list]) => [f, list.length]));
  const r = ratchet("动画/过渡只动 transform·opacity（ui 0 处，旧页只减不增）", counts, BUDGET.motionDebt, "src/components/ui/");
  if (!r.ok) {
    const lines = Object.entries(motion).filter(([f]) => r.detail.includes(f)).flatMap(([f, list]) => list.map((x) => `${f}: ${x}`));
    r.detail += `\n    ${lines.slice(0, 8).join("\n    ")}`;
  }
  ratchet("filter 只减不增（ui 0 处）", filter, BUDGET.filterDebt, "src/components/ui/");
}

function buildDist() {
  if (DIST_ARG) return resolve(DIST_ARG);
  const out = join(CLIENT, "node_modules", ".cache", "ui-check-dist");
  return new Promise((ok, fail) => {
    const child = spawn("pnpm", ["exec", "vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: CLIENT, stdio: ["ignore", "ignore", "pipe"], env: process.env });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`vite build 失败：${err.slice(-400)}`))));
  });
}

async function checkFirstScreen() {
  try {
    const dist = await buildDist();
    const r = firstScreen(dist);
    const cap = BUDGET.firstScreenGzip;
    const over = [];
    if (r.js.gzip > cap.js) over.push(`JS ${kb(r.js.gzip)} > ${kb(cap.js)}`);
    if (r.css.gzip > cap.css) over.push(`CSS ${kb(r.css.gzip)} > ${kb(cap.css)}`);
    const pct = (a, b) => `${a <= b ? "−" : "+"}${Math.abs((1 - a / b) * 100).toFixed(1)}%`;
    return record(`首屏 gzip ≤ ${BUDGET.baseline}`, over.length === 0,
      over.length ? over.join("；") : `JS ${kb(r.js.gzip)}（${pct(r.js.gzip, cap.js)}）  CSS ${kb(r.css.gzip)}（${pct(r.css.gzip, cap.css)}）`);
  } catch (error) {
    return record(`首屏 gzip ≤ ${BUDGET.baseline}`, false, String(error?.message ?? error));
  }
}

// ---------- 浏览器检查 ----------
const PAGES = [
  ["chat", "/"],
  ["diary", "/diary"],
  ["memory", "/memory"],
  ["settings", "/settings"],
  ["surf", "/surf"],
  ["kit", "/__kit"],
];
const CHARACTERS = ["whale", "deepseek", "claude", "chatgpt"];

async function waitForServer(base, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function ensureServer() {
  if (await waitForServer(BASE, 1500)) return { child: null, reused: true };
  const child = spawn("pnpm", ["--dir", "apps/client", "dev", "--port", PORT], { cwd: ROOT, stdio: "ignore", env: process.env });
  const ok = await waitForServer(BASE, 60_000);
  if (!ok) { child.kill("SIGTERM"); throw new Error(`dev server 起不来：${BASE}`); }
  return { child, reused: false };
}

async function loadPlaywright() {
  const require = createRequire(join(CLIENT, "package.json"));
  const pw = await import(pathToFileURL(require.resolve("playwright")).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  const axe = await import(pathToFileURL(require.resolve("@axe-core/playwright")).href);
  const AxeBuilder = axe.AxeBuilder ?? axe.default?.AxeBuilder;
  if (!chromium || !AxeBuilder) throw new Error("playwright / @axe-core/playwright 解析失败");
  return { chromium, AxeBuilder };
}

async function openPage(browser, { width, height, elder = false, theme = null, character = null, motion = false }) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion ? "no-preference" : "reduce", deviceScaleFactor: 1 });
  const page = await context.newPage();
  await stubApi(page);
  // 引导是一次性全屏：截图与测量都要先标记「看过」，否则四页拍到的都是引导页
  await page.addInitScript(({ elder, theme, character }) => {
    localStorage.setItem("wp.onboarded", "1");
    if (elder) localStorage.setItem("wp.elder", "on");
    if (theme) localStorage.setItem("wp.theme", theme);
    if (character) localStorage.setItem("wp.character", character);
  }, { elder, theme, character });
  return { context, page };
}

async function visit(page, path) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/** 触控目标：可见的 button/a/[role]/input/textarea；a 是行内文字链接时不拦（§12.3 例外）。 */
const TOUCH_JS = (min) => {
  const sel = 'button, a, input, textarea, select, [role="button"], [role="tab"], [role="switch"], [role="radio"], [role="link"], [role="checkbox"]';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width <= 0 || r.height <= 0 || cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.tagName === "A" && cs.display === "inline") continue; // 正文行内链接
    if (r.width < min || r.height < min) {
      const name = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}`;
      out.push(`${name} ${Math.round(r.width)}×${Math.round(r.height)}「${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 10)}」`);
    }
  }
  return [...new Set(out)];
};

async function checkTouch(browser) {
  const fails = [];
  let measured = 0;
  for (const elder of [false, true]) {
    const min = elder ? 56 : 44;
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const { context, page } = await openPage(browser, { ...vp, elder });
      for (const [name, path] of PAGES) {
        await visit(page, path);
        const bad = await page.evaluate(TOUCH_JS, min);
        measured += 1;
        for (const b of bad.slice(0, 3)) fails.push(`${name}@${vp.width}${elder ? "/elder" : ""} ${b}`);
      }
      await context.close();
    }
  }
  return record(`触控目标 ≥44px（老人 ≥56px，${measured} 次页面测量）`, fails.length === 0, fails.length ? fails.slice(0, 10).join("；") : "0 处");
}

async function checkHorizontalScroll(browser) {
  const fails = [];
  for (const [name, path] of PAGES) {
    const { context, page } = await openPage(browser, { width: 380, height: 560 });
    await visit(page, path);
    const narrow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (narrow > 0) fails.push(`${name}@380 溢出 ${narrow}px`);
    await page.evaluate(() => document.documentElement.style.setProperty("--scale", "2"));
    await page.waitForTimeout(300);
    const scaled = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (scaled > 0) fails.push(`${name}@scale2 溢出 ${scaled}px`);
    await context.close();
  }
  return record("横向滚动 ≤ 视口（380px 与 --scale=2）", fails.length === 0, fails.length ? fails.join("；") : "0 处");
}

async function checkAxe(browser, AxeBuilder) {
  const fails = [];
  let runs = 0;
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page } = await openPage(browser, vp);
    for (const [name, path] of PAGES) {
      await visit(page, path);
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      runs += 1;
      const bad = res.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      for (const v of bad) {
        const target = v.nodes[0]?.target?.join(" ") ?? "";
        fails.push(`${name}@${vp.width} ${v.id}(${v.nodes.length}) ${target}`.slice(0, 120));
      }
    }
    await context.close();
  }
  return record(`axe wcag2a/2aa/21aa/22aa（${runs} 次扫描，critical+serious）`, fails.length === 0, fails.length ? fails.slice(0, 10).join("；") : "0 处");
}


/** 15. 静置与隐藏：真实动效（不开 reduced-motion），先确认确有环境动画，再看静置与隐藏后是否停下。 */
async function checkIdleAndHidden(browser) {
  const fails = [];
  const notes = [];
  for (const [name, path] of PAGES) {
    const { context, page } = await openPage(browser, { width: 1440, height: 900, motion: true });
    await page.addInitScript(instrumentTimers);
    await visit(page, path);
    // 每页都等满再统计：页面卡在 loading 或延迟启动的循环动画，只看开头会漏掉。
    // 加载转圈（ui-spin）只在组件预览页豁免（那里是常驻的示例）；生产页静置后还在转就算失败。
    const loops = async () => (await page.evaluate(runningAnimations)).filter((a) => a.endsWith("∞") && !(path === "/__kit" && a.includes(":ui-spin")));
    const before = await loops();
    await page.waitForTimeout(9500); // 空闲门槛 8 秒（src/lib/activity.ts）
    const after = await loops();
    notes.push(`${name} ${before.length}→${after.length}`);
    if (after.length) fails.push(`${name} 静置后仍在跑：${after.slice(0, 4).join("、")}`);
    await page.evaluate(() => window.__wpSetHidden(true));
    await page.waitForTimeout(300);
    const hidden = await page.evaluate(runningAnimations);
    if (hidden.length) fails.push(`${name} 隐藏后仍在跑：${hidden.slice(0, 4).join("、")}`);
    await context.close();
  }
  return record(`静置 / 隐藏后动画停下（${PAGES.length} 页）`, fails.length === 0, fails.length ? fails.join("；") : `静置前→9.5s 后循环动画 ${notes.join("、")}；隐藏后 0`);
}

/** 16. 懒加载页借用的组件样式还在：/surf 弹出的便签是 fixed 的小条；标签的 aria-controls 都指向真有的面板。 */
async function checkLazyStyles(browser) {
  const fails = [];
  const { context, page } = await openPage(browser, { width: 1440, height: 900 });
  await visit(page, "/surf");
  // 假后端对 /api/surf/run 回 200（不是 202），页面会弹「现在叫不动她」的便签
  await page.getByRole("button", { name: "让她现在去逛逛" }).first().click();
  const toast = await page.waitForSelector(".toast", { timeout: 3000 }).catch(() => null);
  let toastNote = "没弹出";
  if (!toast) fails.push("surf 点「让她现在去逛逛」后没有便签");
  else {
    const box = await toast.evaluate((el) => ({ position: getComputedStyle(el).position, width: Math.round(el.getBoundingClientRect().width) }));
    toastNote = `${box.position} ${box.width}px`;
    if (box.position !== "fixed" || box.width > 420) fails.push(`surf 便签样式丢了：${toastNote}`);
  }
  await context.close();
  let tabs = 0;
  const { context: c2, page: p2 } = await openPage(browser, { width: 1440, height: 900 });
  for (const [name, path] of PAGES) {
    await visit(p2, path);
    const dangling = await p2.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => {
      const id = t.getAttribute("aria-controls");
      return id && !document.getElementById(id) ? (t.textContent || "").trim().slice(0, 8) : null;
    }).filter(Boolean));
    // 反过来：渲染出来的每个面板，它的标签都要指向它（TabPanel 被 Fragment 包住时曾经丢过）
    const orphan = await p2.evaluate(() => [...document.querySelectorAll('[role="tabpanel"]')].map((p) => {
      // 日记页是几个标签共用一个面板（aria-label 命名，不带 aria-labelledby），所以只要有标签指向它就算数
      const pointed = [...document.querySelectorAll('[role="tab"]')].some((t) => t.getAttribute("aria-controls") === p.id);
      return pointed ? null : (document.getElementById(p.getAttribute("aria-labelledby") || "")?.textContent || p.id).trim().slice(0, 8);
    }).filter(Boolean));
    tabs += await p2.evaluate(() => document.querySelectorAll('[role="tab"]').length);
    for (const d of dangling) fails.push(`${name} 标签「${d}」的 aria-controls 指向不存在的面板`);
    for (const o of orphan) fails.push(`${name} 面板「${o}」的标签没写 aria-controls`);
  }
  await c2.close();
  return record("懒加载页的共享样式 / 标签面板指向", fails.length === 0, fails.length ? fails.join("；") : `surf 便签 ${toastNote}；${tabs} 个标签无悬空 aria-controls，面板都有标签指向`);
}

async function shoot(browser) {
  mkdirSync(SHOTS, { recursive: true });
  const written = [];
  for (const theme of ["light", "dark"]) {
    const { context, page } = await openPage(browser, { width: 1440, height: 900, theme });
    for (const [name, path] of PAGES) {
      await visit(page, path);
      const file = join(SHOTS, `${name}-1440x900-${theme}.png`);
      await page.screenshot({ path: file });
      written.push(rel(file));
    }
    await context.close();
  }
  // 组件预览页：4 角色 × 亮/暗，外加手机宽、老人模式，以及弹层钉住打开
  const kit = [
    ...CHARACTERS.flatMap((character) => ["light", "dark"].map((theme) => ({ tag: `${character}-${theme}`, theme, character, width: 1440, height: 900 }))),
    { tag: "whale-light-390", theme: "light", character: "whale", width: 390, height: 844 },
    { tag: "whale-light-elder", theme: "light", character: "whale", width: 1440, height: 900, elder: true },
    ...["dialog", "confirm", "select", "tooltip"].map((open) => ({ tag: `open-${open}`, theme: "light", character: "whale", width: 1440, height: 900, query: `?open=${open}` })),
  ];
  for (const shot of kit) {
    const { context, page } = await openPage(browser, shot);
    await visit(page, `/__kit${shot.query ?? ""}`);
    // 钉住的下拉在首屏以下：滚到视口中间再拍（打开的 Select 会锁滚动，只能程序滚）
    if (shot.query) await page.evaluate(() => document.querySelector(".uikit__pinned")?.scrollIntoView({ block: "center" }));
    const file = join(SHOTS, `kit-${shot.tag}.png`);
    await page.screenshot({ path: file, fullPage: !shot.query });
    written.push(rel(file));
    await context.close();
  }
  return written;
}

// ---------- 主流程 ----------
if (argv.includes("--debt")) {
  const { motion, filter } = scanMotionDebt();
  console.log(JSON.stringify({ motionDebt: Object.fromEntries(Object.entries(motion).map(([f, l]) => [f, l.length])), filterDebt: filter, detail: motion }, null, 2));
  process.exit(0);
}
console.log(`重设计验收 · ${rel(resolve(fileURLToPath(import.meta.url)))}  ·  ${STATIC_ONLY ? "只跑源码检查" : BASE}\n`);

checkContrast();
checkObsoleteTokens();
checkBannedUsage();
checkNativeDialogs();
checkRadius();
checkMotionTokens();
checkRuntimeDeps();
checkMotionDebt();
if (!STATIC_ONLY) await checkFirstScreen();

if (STATIC_ONLY) {
  console.log("（--static：跳过构建与浏览器检查：首屏体积 / 触控 / 横向滚动 / axe / 静置隐藏）\n");
} else {
  let server = null;
  try {
    const loaded = await ensureServer();
    server = loaded.child;
    const { chromium, AxeBuilder } = await loadPlaywright();
    const browser = await launchChrome(chromium);
    await checkTouch(browser);
    await checkHorizontalScroll(browser);
    await checkAxe(browser, AxeBuilder);
    await checkIdleAndHidden(browser);
    await checkLazyStyles(browser);
    if (WITH_SHOTS) {
      const written = await shoot(browser);
      record(`截图 ${written.length} 张（${PAGES.length} 页 × 亮/暗，预览页 × 角色 / 手机 / 老人 / 弹层）`, true, `${rel(SHOTS)}/`);
    }
    await browser.close();
  } catch (error) {
    record("浏览器检查", false, String(error?.message ?? error));
  } finally {
    if (server) server.kill("SIGTERM");
  }
}

// 中文按两个字符宽算，输出才对得齐
const displayWidth = (s) => [...s].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - displayWidth(s)));
const width = Math.max(...results.map((r) => displayWidth(r.name)));
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${pad(r.name, width)}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} 项检查，${failed.length} 项失败。`);
process.exit(failed.length === 0 ? 0 : 1);
