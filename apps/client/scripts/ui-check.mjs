#!/usr/bin/env node
/**
 * 界面验收 · 一条命令跑完全部机器检查（docs/UI_SPEC.md §12.2 / §12.3）。
 *
 *   pnpm --dir apps/client run ui:check                    全跑（会自己起 vite dev，跑完关掉）
 *   pnpm --dir apps/client run ui:check --static           只跑源码检查，不开浏览器
 *   pnpm --dir apps/client run ui:check --shots            另外拍 7 页 × 亮/暗、预览页和好感度卡五档 / 升级帧，存到 apps/client/test-results/ui-check/
 *   pnpm --dir apps/client run ui:check --base=http://127.0.0.1:1420   复用已在跑的 dev server
 *   pnpm --dir apps/client run ui:check --debt             打印各文件的动效 / filter 存量（JSON），用来调低 perf-budget.json
 *
 * 检查项（编号与输出顺序一致）：
 *  1  对比度（亮/暗 × 4 角色 × 正文/语义层，复用 contrast-check.mjs）
 *  2  淘汰 token（ink-faint / --rule / --ground / --radius / --font-serif / --sea / --ease / --chat-w）
 *  3  gradient / backdrop-filter
 *  4  珊瑚色作文字
 *  5  window.confirm / window.alert
 *  6  圆角只允许 var(--r-*) / 50% / 0
 *  7  动效参数只在 tokens（CSS 无字面时长、TSX 无手写弹簧）
 *  8  运行时依赖只允许清单里的包（不加 UI 库 / 动画库 / CSS-in-JS；基线在 scripts/perf-budget.json，docs/DESIGN.md §性能预算）
 *  9  动画与过渡只动 transform / opacity；components/ui 必须 0 处，旧页面按文件只减不增
 *  10 filter 按文件只减不增（backdrop-filter 由第 3 项拦）
 *  11 首屏 JS / CSS gzip 只打印、不设上限；首屏文件里不能出现卡面代码（acard）；构建失败才算失败
 *  12 触控目标 ≥44px（老人模式 ≥56px）
 *  13 横向滚动 ≤ 视口（380px 与 --scale=2）
 *  14 外壳：1440 点「收起导航」后 nav 72px、main 从 x=72 起；再展开回 200；900 图标栏链接有可访问名称
 *  15 键盘弹起（390/720/900，可视高 480）：外壳收到 480，720/900 主栏占满宽度，输入框和发送键都在可视区内
 *  16 聊天几何：3 档宽度 × done/thinking/failed 可画区不低于 225e9e3；390 输入条不压底栏（thinking/failed 点发送键进入，断言 /api/chat 发出 1 次、状态已出现）
 *  17 聊天紧凑浮层：焦点进入、Escape 关闭、关闭回焦；done sr-only 全文常驻
 *  18 日记月/年导航：900 与 390 老人模式跳转/今日可见、无横向溢出
 *  19 手机底栏：719px 及以下文字标签可见（390 / 719 / 390 老人）
 *  20 老人模式图标栏：900 / 720 / 1440 收起后链接都不小于 56×56
 *  21 axe wcag2a/2aa/21aa/22aa，critical + serious = 0
 *  22 每页静置 9.5 秒后没有还在跑的循环动画（加载转圈只在 /__kit 豁免）；页面隐藏后没有任何还在跑的动画
 *  23 懒加载页借用的组件样式还在（/surf 的便签是 fixed 小条），标签的 aria-controls 不悬空、渲染的面板都有标签指向；loading / aria-disabled 按钮不提交不回调；字段标签都连到控件（控件自带 id 时连到它）
 *  24 记忆页 / 见闻页用 ui 组件（Tabs / Card / Dialog / 确认框），无旧手账卡
 *  25 记忆页返工（初审 8 条）：撤回跟删除同生共死（悬停超过 5 秒撤回仍在、DELETE 未发）/ 撤回不发 DELETE / 切页结算无残留 / 空分类有空态 / 清空 ✕ ≥44 / 弹层关闭焦点回到触发处 / 老人模式 390 日期格不叠 / 危险入口描边靠左 / 条数只在「全部」标签一处
 *  26 好感度卡（/__kit/cards）完整动效 1→5 逐档快进且 ≤3 秒、4→5 按时播完、中途能跳过；StrictMode 下每轮结束回调正好 1 次
 *  27 跳过与到点的定时器同一拍：卡不复活、回调不多一次
 *  28 安静模式开关与系统减少动态：只淡入、按时播完
 *  29 缩略卡给了 upgradeFrom 也不播、不出提示和跳过、不回调
 *  30 播放中清空 upgradeFrom / 卸载卡片：这一轮作废，到点也不回调
 *  31 名字牌和档位点对读屏隐藏，主卡、缩略卡的 ariaSnapshot 只有卡根的 aria-label
 *  32 触屏横向拖动倾斜，松手复位
 *  33 设置页：存了 Codex 模型后顶部概览同步；点目录后亮的就是刚点的那项（桌面、手机 380 × 字号 2 倍）
 *  34 好感度卡接真实等级（#160）：用假接口把好感度从 Lv3 改成 Lv4 并刷新，卡面正好播一次 3→4，播完记成 4；再开、刷新页面都不重播；换角色互不影响（各记各的）；首次、清掉存储不播；读取失败有重试，重试后不播
 *  35 换一位：主卡与缩略卡共用等级；单卡失败可重试，重试一起恢复，切角色不多发请求
 *  36 聊天页跨档提示一次、同一档不重复；点「去看看」打开设置页卡面并播升级
 *  37 切档看低档卡面：只能切已解锁的档；只改卡面，卡外真实等级、「上次看到的等级」不动，不发写请求；Live2D 舞台切档不重建；刷新后保留；真升档时播动画并回到最高档
 *  38 设置页点目录「关于」：只滚页面，html 不滚、侧栏 y=0 满高（1440 / 900）
 *  39 见闻工具条：1440 / 1180 筛选、搜索、「让她现在去逛逛」同一行；900 / 390 换行不溢出
 *  40 聊天页没有对话时不留空右栏，舞台和画布铺满内容宽（1440 / 1180）；有对话时右栏照常
 *  41 收起 / 展开导航按钮两态同一位置，原地再点即展开
 *  42 页头：聊天页没有页头；另外四页标题行位置、宽度、字号、到正文间距一致（1440 / 1180 / 900 / 390）；五页都没有面包屑（日常 · / 手帐 · / 系统 ·）和日记、记忆那两句说明
 *  43 聊天舞台人物撑满：只留画布量看得见的像素，构图方向占可画区 ≥85%，待机摆动不碰舞台两侧（1440 / 1180 无对话 / 1180 / 900 / 390）
 *  44 聊天主区平铺：.room__main 无圆角、边框、底色、描边阴影，舞台贴着内容区左上角并铺到右栏或内容区右边（1440 / 1180 无对话 / 900）
 *  45 见闻页「她今天逛了…」在标题右侧同一行，颜色是次要文字色、和标题不同色（1440 / 1180 / 900）
 *  46 设置页滚动（400 / 1100 / 2000）：吸顶目录条横向盖住卡片列和描边，卡片滑过时点在条上的都是条，页面无横向溢出（1440 / 1180 / 900 / 390）
 *  47 侧栏与往回翻宽度：展开侧栏 200（老人模式随字号 ×1.25 = 250），品牌字 / 导航项 / 分组名 / 她的卡片不截断不换行（1440 / 1180 / 1180 老人）；往回翻右栏 ≤360 且 ≤ 内容区 31%（1920 / 1440 / 1180，无对话点开与有对话常驻），900 抽屉从右侧滑出 ≤360、390 仍是底部抽屉；右栏打开时人物仍占可画区 ≥85%（1440 / 1180）
 *  48 输入条与收起按钮：视频 / 语音 / 发送三个按钮中心和单行输入框中心竖直差 ≤1px，多行时贴最后一行 ≤1px；语音紧挨发送、在输入框右边，视频在左边（1440 / 1180 / 1180 老人 / 900 / 390）；收起按钮和品牌标记同一行、收起前后不动，她的卡片下面不再空出一行（1440 / 1180 / 1180 老人）
 *  49 弹层关上后焦点回到打开它的按钮：往回翻抽屉 900 / 390 × Escape / 「关上」，设置页「换一位」Escape / ✕
 *  50 往回翻右栏默认收起、回复生成完不自动展开（1440 / 1180 / 900 / 390）：消息留在主区底部；点「往回翻」才展开并能看到刚生成的那条，再点收起
 * （默认共 50 项；--shots 再加一项截图，共 51 项）
 *
 * 退出码：0 全绿；1 有失败。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "./browser.mjs";
import { DEFAULT_LEVELS, FIXTURES, stubApi } from "./ui-fixtures.mjs";
import { firstScreen, kb, readBudget } from "./perf-budget.mjs";
import { instrumentTimers, runningAnimations } from "./perf-idle.mjs";
import { contrastRows, isCardStyleException, scanBannedUsage, stripComments } from "./contrast-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..");
const ROOT = join(CLIENT, "..", "..");
const SRC = join(CLIENT, "src");
const SHOTS = join(CLIENT, "test-results", "ui-check");
/** 展开侧栏宽度（shell.css --shell-nav-w）。 */
const NAV_W = 200;

const argv = process.argv.slice(2);
const STATIC_ONLY = argv.includes("--static");
const WITH_SHOTS = argv.includes("--shots");
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7);
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
    // 卡面（LazyAffinityCard）按需加载：首屏的 JS / CSS 里不能出现它的类名；体积只打印，不设上限
    const leaked = [...r.js.files, ...r.css.files].filter((f) => /acard/.test(readFileSync(join(dist, f.url), "utf8"))).map((f) => f.url);
    return record("首屏 gzip（只打印）", leaked.length === 0,
      `JS ${kb(r.js.gzip)}  CSS ${kb(r.css.gzip)}${leaked.length ? `；首屏文件里有卡面代码：${leaked.join("、")}` : "；首屏文件无 acard"}`);
  } catch (error) {
    return record("首屏 gzip（只打印）", false, String(error?.message ?? error));
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
  ["cards", "/__kit/cards"],
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

async function openPage(browser, { width, height, elder = false, theme = null, character = null, motion = false, touch = false, levels = DEFAULT_LEVELS }) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion ? "no-preference" : "reduce", deviceScaleFactor: 1, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage();
  await stubApi(page, levels);
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
        if (path === "/settings") {
          // 「换一位」弹窗里的切档按钮只有弹窗打开时才在 DOM 里，页面级扫描覆盖不到。
          await page.locator(".set-her__swap").click();
          await page.locator(".card-view__btn").first().waitFor({ timeout: 5000 });
          await page.waitForTimeout(500);
          const sizes = await page.locator(".card-view__btn").evaluateAll((els) => els.map((el) => {
            const r = el.getBoundingClientRect();
            return { w: r.width, h: r.height, text: (el.textContent || "").trim() };
          }));
          measured += 1;
          const small = sizes.filter((s) => s.w < min || s.h < min);
          if (small.length) fails.push(`设置·换一位@${vp.width}${elder ? "/elder" : ""} ${small.map((s) => `${s.text} ${Math.round(s.w)}×${Math.round(s.h)}`).join("、")}`);
          await page.keyboard.press("Escape");
          await page.locator(".set-dialog--chars").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
        }
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

/** 28. 外壳：桌面手动收起后父级列宽跟到 72px；900 图标栏的链接仍有可访问名称。 */
async function checkShellNav(browser) {
  const fails = [];
  const { context, page } = await openPage(browser, { width: 1440, height: 900 });
  await visit(page, "/settings");
  const measure = () => page.evaluate(() => {
    const nav = document.querySelector(".shell-nav")?.getBoundingClientRect();
    const main = document.querySelector("#main")?.getBoundingClientRect();
    return { nav: Math.round(nav?.width ?? -1), mainX: Math.round(main?.x ?? -1) };
  });

  const before = await measure();
  if (before.nav !== NAV_W || before.mainX !== NAV_W) fails.push(`展开时 nav ${before.nav} / main x ${before.mainX}，应为 ${NAV_W} / ${NAV_W}`);
  await page.getByRole("button", { name: "收起导航" }).click();
  await page.waitForTimeout(200);
  const after = await measure();
  if (after.nav !== 72) fails.push(`收起后 nav ${after.nav}px，应为 72`);
  if (after.mainX !== 72) fails.push(`收起后 main x ${after.mainX}px，应为 72`);
  const expanded = await page.getByRole("button", { name: "展开导航" }).getAttribute("aria-expanded");
  if (expanded !== "false") fails.push(`收起后 aria-expanded=${expanded}，应为 false`);
  await page.getByRole("button", { name: "展开导航" }).click();
  await page.waitForTimeout(200);
  const reopened = await measure();
  if (reopened.nav !== NAV_W || reopened.mainX !== NAV_W) fails.push(`再展开后 nav ${reopened.nav} / main x ${reopened.mainX}，应为 ${NAV_W} / ${NAV_W}`);
  await context.close();

  const narrow = await openPage(browser, { width: 900, height: 900 });
  await visit(narrow.page, "/settings");
  for (const name of ["聊天", "日记", "记忆", "见闻", "设置"]) {
    if ((await narrow.page.getByRole("link", { name, exact: true }).count()) !== 1) fails.push(`900 图标栏读不到链接「${name}」`);
  }
  const labels = await narrow.page.locator(".shell-nav__item").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  if (labels.some((label) => !label)) fails.push(`900 图标栏有链接缺 aria-label：${labels.map((v) => v ?? "null").join("、")}`);
  await narrow.context.close();

  const detail = fails.length ? fails.join("；") : `展开 ${before.nav}/${before.mainX} → 收起 ${after.nav}/${after.mainX} → 再展开 ${reopened.nav}/${reopened.mainX}；900 链接名称 5/5`;
  return record("外壳：1440 收起导航列宽 72、main 从 72 起；900 图标栏链接可访问", fails.length === 0, detail);
}

/** 38–49. 界面打磨（fix/ui-polish）：设置页「关于」不带走外壳 / 见闻工具条一行 / 无对话时聊天铺满 / 收起展开按钮原位 / 页头 / 人物撑满 / 主区平铺 / 见闻状态行 / 设置目录条不重叠 / 侧栏与往回翻宽度。 */
async function checkUiPolish(browser) {
  const box = (sel) => (el => el ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect()) : null)(document.querySelector(sel));
  const BOX = `(${box.toString()})`;

  // 38 设置页点目录里的「关于」：只滚页面，外壳（侧栏）不跟着往上走
  {
    const fails = [];
    let detail = "";
    for (const [width, height] of [[1440, 900], [900, 800]]) {
      const { context, page } = await openPage(browser, { width, height });
      await visit(page, "/settings");
      await page.locator(".set-nav__item", { hasText: "关于" }).click();
      await page.waitForTimeout(900);
      const m = await page.evaluate((B) => {
        const box = eval(B);
        return { html: document.documentElement.scrollTop, body: document.body.scrollTop, nav: box(".shell-nav"), page: document.querySelector(".page--settings")?.scrollTop ?? -1 };
      }, BOX);
      if (m.html !== 0 || m.body !== 0) fails.push(`${width}：html/body 被滚了 ${m.html}/${m.body}px`);
      if (!m.nav || m.nav.y !== 0 || m.nav.h !== height) fails.push(`${width}：侧栏 y=${m.nav?.y} 高 ${m.nav?.h}，应为 0 / ${height}`);
      if (m.page <= 0) fails.push(`${width}：设置页没有滚到「关于」（scrollTop ${m.page}）`);
      detail += `${width}: html ${m.html} 侧栏 y${m.nav?.y} h${m.nav?.h} 页滚 ${m.page}；`;
      await context.close();
    }
    record("设置页点「关于」：只滚页面，侧栏不动、满高（1440 / 900）", fails.length === 0, fails.join("；") || detail);
  }

  // 39 见闻工具条：宽时筛选、搜索、「让她现在去逛逛」一行；窄时降级换行但不溢出
  {
    const fails = [];
    let detail = "";
    for (const [width, height, oneRow] of [[1440, 900, true], [1180, 800, true], [900, 800, false], [390, 844, false]]) {
      const { context, page } = await openPage(browser, { width, height });
      await visit(page, "/surf");
      const m = await page.evaluate((B) => {
        const box = eval(B);
        const bar = document.querySelector(".surf-bar");
        return { bar: box(".surf-bar"), filters: box(".surf-filters"), search: box(".surf-search"), run: box(".surf-run"), over: bar ? bar.scrollWidth - bar.clientWidth : -1 };
      }, BOX);
      if (!m.run || !m.search || !m.filters) { fails.push(`${width}：工具条缺元素`); await context.close(); continue; }
      const mid = (b) => b.y + b.h / 2;
      const same = Math.abs(mid(m.run) - mid(m.filters)) <= 2 && Math.abs(mid(m.search) - mid(m.filters)) <= 2;
      if (oneRow && !same) fails.push(`${width}：按钮不在同一行（筛选中线 ${mid(m.filters)} / 搜索 ${mid(m.search)} / 逛逛 ${mid(m.run)}）`);
      if (m.over > 0) fails.push(`${width}：工具条横向溢出 ${m.over}px`);
      if (m.run.x + m.run.w > m.bar.x + m.bar.w + 1) fails.push(`${width}：「让她现在去逛逛」伸出工具条`);
      detail += `${width}: ${same ? "一行" : "换行"}；`;
      await context.close();
    }
    record("见闻工具条：1440 / 1180 一行放下，900 / 390 换行不溢出", fails.length === 0, fails.join("；") || detail);
  }

  // 40 聊天页还没有对话时：右栏不留空，舞台和对话区铺满内容宽度
  {
    const fails = [];
    let detail = "";
    for (const [width, height, empty] of [[1440, 900, true], [1180, 800, true], [1440, 900, false]]) {
      const { context, page } = await openPage(browser, { width, height });
      if (empty) await page.route("**/api/chat/history**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) }));
      await visit(page, "/");
      await page.waitForTimeout(600);
      const m = await page.evaluate((B) => {
        const box = eval(B);
        return { inner: box(".chat-page"), main: box(".room__main"), aside: box(".room__aside"), canvas: box(".scene canvas, .live2d canvas") };
      }, BOX);
      if (empty) {
        if (m.aside) fails.push(`${width} 无对话：右栏还在（${m.aside.w}px）`);
        if (!m.main || Math.abs(m.main.w - m.inner.w) > 1) fails.push(`${width} 无对话：舞台宽 ${m.main?.w}，内容区 ${m.inner?.w}`);
        if (m.canvas && Math.abs(m.canvas.w - m.main.w) > 1) fails.push(`${width} 无对话：画布宽 ${m.canvas.w}，舞台 ${m.main.w}`);
      } else if (m.aside) fails.push(`${width} 有对话：右栏默认不该展开（${m.aside.w}px）`);
      detail += `${width}${empty ? " 无对话" : " 有对话"}: 舞台 ${m.main?.w}/${m.inner?.w}${m.aside ? ` 右栏 ${m.aside.w}` : ""}；`;
      await context.close();
    }
    record("聊天页舞台铺满内容宽（1440 / 1180）：无对话、有对话默认都不留右栏", fails.length === 0, fails.join("；") || detail);
  }

  // 41 收起 / 展开导航：按钮前后同一个位置，鼠标不动再点一下就展开回来
  {
    const fails = [];
    const { context, page } = await openPage(browser, { width: 1440, height: 900 });
    await visit(page, "/");
    const toggle = page.locator(".shell-nav__toggle");
    const a = await toggle.boundingBox();
    await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await page.waitForTimeout(300);
    const b = await toggle.boundingBox();
    const navCollapsed = await page.evaluate(() => Math.round(document.querySelector(".shell-nav").getBoundingClientRect().width));
    if (navCollapsed !== 72) fails.push(`点了没收起（nav ${navCollapsed}）`);
    if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5) fails.push(`按钮从 (${Math.round(a.x)},${Math.round(a.y)}) 挪到 (${Math.round(b.x)},${Math.round(b.y)})`);
    await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await page.waitForTimeout(300);
    const navOpen = await page.evaluate(() => Math.round(document.querySelector(".shell-nav").getBoundingClientRect().width));
    if (navOpen !== NAV_W) fails.push(`原地再点没展开（nav ${navOpen}）`);
    await context.close();
    record("收起 / 展开导航：按钮位置不变，原地再点即展开", fails.length === 0, fails.join("；") || `按钮 (${Math.round(a.x)},${Math.round(a.y)}) 两态一致；72 → ${NAV_W}`);
  }

  // 42 页头：聊天页不要页头；另外四页标题行位置、宽、字号、到正文间距一致（1440 / 1180 / 900 / 390）；五页都没有面包屑和那几句说明
  {
    const fails = [];
    const notes = [];
    const banned = ["日常 · 聊天", "手帐 · ", "系统 · 设置", "和大肥鱼在一起", "她每天写一页", "按周、月、年翻着看", "还没有记下的事", "聊得多了，她会自己记"];
    for (const [width, height] of [[1440, 900], [1180, 780], [900, 800], [390, 844]]) {
      const { context, page } = await openPage(browser, { width, height });
      const rows = [];
      for (const path of ["/", "/diary", "/memory", "/surf", "/settings"]) {
        await visit(page, path);
        const m = await page.evaluate(() => {
          const main = document.querySelector("#main");
          const h = main?.querySelector(".page-head");
          const text = main?.innerText ?? "";
          const eyebrow = document.querySelectorAll(".page-head__eyebrow, .page-head__lead").length;
          if (!h) return { head: null, text, eyebrow };
          const r = h.getBoundingClientRect();
          const t = h.querySelector(".page-head__title");
          const n = h.nextElementSibling?.getBoundingClientRect();
          return { head: { y: Math.round(r.y), x: Math.round(r.x), w: Math.round(r.width), size: t ? getComputedStyle(t).fontSize : "", gap: n ? Math.round(n.y - r.bottom) : -1 }, text, eyebrow };
        });
        for (const word of banned) if (m.text.includes(word)) fails.push(`${width} ${path} 还有「${word}」`);
        if (m.eyebrow) fails.push(`${width} ${path} 还有面包屑 / 说明行`);
        if (path === "/") {
          if (m.head) fails.push(`${width} 聊天页还有页头`);
          if (m.text.includes("DeepSeek 鲸鱼娘")) fails.push(`${width} 聊天页正文里还有「DeepSeek 鲸鱼娘」`);
        } else if (!m.head) fails.push(`${width} ${path} 没有标题行`);
        else rows.push([path, m.head]);
      }
      const first = rows[0]?.[1];
      for (const [path, r] of rows) {
        if (r.y !== first.y || r.x !== first.x || r.w !== first.w || r.size !== first.size || r.gap !== first.gap) fails.push(`${width} ${path} 标题行 y${r.y} x${r.x} w${r.w} ${r.size} 距${r.gap}，和 ${rows[0][0]}（y${first.y} x${first.x} w${first.w} ${first.size} 距${first.gap}）不一致`);
      }
      if (first) notes.push(`${width}: x${first.x} y${first.y} w${first.w} ${first.size} 距${first.gap}`);
      await context.close();
    }
    record("页头：聊天页无页头；四页标题行一致（1440 / 1180 / 900 / 390）；五页无面包屑和说明句", fails.length === 0, fails.join("；") || notes.join("；"));
  }

  // 43 聊天舞台的人物撑满：只留画布、量看得见的像素，构图方向（高或宽）至少占可画区 85%，动作摆到最开也不碰两侧
  {
    const fails = [];
    let detail = "";
    for (const [width, height, empty] of [[1440, 900, false], [1180, 780, true], [1180, 780, false], [900, 800, false], [390, 844, false]]) {
      const { context, page } = await openPage(browser, { width, height, touch: width === 390 });
      if (empty) await page.route("**/api/chat/history**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) }));
      await visit(page, "/");
      await page.waitForTimeout(1500);
      const scene = await page.evaluate(() => { const s = document.querySelector(".scene"); return s ? { h: s.getBoundingClientRect().height, safe: Number.parseFloat(getComputedStyle(s).getPropertyValue("--scene-safe")) || 0 } : null; });
      const art = scene ? await artExtent(page) : null;
      const tag = `${width}${empty ? " 无对话" : ""}`;
      if (!art || art.r < 0) { fails.push(`${tag}：画布上没量到人物`); await context.close(); continue; }
      const drawable = scene.h - scene.safe;
      const fill = Math.max((art.b - art.t) / drawable, (art.r - art.l) / art.w);
      if (fill < 0.85) fails.push(`${tag}：人物只占 ${(fill * 100).toFixed(0)}%（高 ${art.b - art.t}/${Math.round(drawable)}，宽 ${art.r - art.l}/${art.w}）`);
      if (art.l < 3 || art.r > art.w - 4) fails.push(`${tag}：人物碰到舞台边（${art.l}–${art.r} / ${art.w}）`);
      detail += `${tag} ${(fill * 100).toFixed(0)}%；`;
      await context.close();
    }
    record("聊天舞台人物撑满可画区 ≥85%，摆动不出边（1440 / 1180 / 900 / 390）", fails.length === 0, fails.join("；") || detail);
  }

  // 44 聊天主区平铺：没有圆角卡（边框、圆角、底色、阴影），舞台贴着内容区左上角，铺到右栏或内容区右边
  {
    const fails = [];
    let detail = "";
    for (const [width, height, empty] of [[1440, 900, false], [1180, 780, true], [900, 800, false]]) {
      const { context, page } = await openPage(browser, { width, height });
      if (empty) await page.route("**/api/chat/history**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) }));
      await visit(page, "/");
      await page.waitForTimeout(400);
      const m = await page.evaluate((B) => {
        const box = eval(B);
        const el = document.querySelector(".room__main");
        if (!el) return null;
        const cs = getComputedStyle(el);
        const after = getComputedStyle(el, "::after");
        return {
          radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, bg: cs.backgroundColor, shadow: cs.boxShadow,
          afterShadow: after.content !== "none" ? after.boxShadow : "none",
          main: box(".room__main"), area: box("#main"), aside: box(".room__aside"),
        };
      }, BOX);
      const tag = `${width}${empty ? " 无对话" : ""}`;
      if (!m) { fails.push(`${tag}：没有 .room__main`); await context.close(); continue; }
      if (m.radius !== "0px") fails.push(`${tag}：主区还有圆角 ${m.radius}`);
      if (m.border !== "0px") fails.push(`${tag}：主区还有边框 ${m.border}`);
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(m.bg)) fails.push(`${tag}：主区还有底色 ${m.bg}`);
      if (m.shadow !== "none" || m.afterShadow !== "none") fails.push(`${tag}：主区还有描边阴影`);
      if (m.main.x !== m.area.x || m.main.y !== m.area.y) fails.push(`${tag}：舞台从 (${m.main.x},${m.main.y}) 起，内容区 (${m.area.x},${m.area.y})`);
      const right = m.aside && m.aside.x > m.main.x ? m.aside.x : m.area.x + m.area.w;
      if (Math.abs(m.main.x + m.main.w - right) > 1) fails.push(`${tag}：舞台右边 ${m.main.x + m.main.w}，应到 ${right}`);
      detail += `${tag} 舞台 ${m.main.w}×${m.main.h}@${m.main.x},${m.main.y}；`;
      await context.close();
    }
    record("聊天主区平铺：无圆角 / 边框 / 底色，舞台贴满内容区（1440 / 1180 / 900）", fails.length === 0, fails.join("；") || detail);
  }

  // 45 见闻页：「她今天逛了…」跟在标题「…的见闻」右边同一行，字色是次要文字色，比标题浅
  {
    const fails = [];
    let detail = "";
    for (const [width, height] of [[1440, 900], [1180, 800], [900, 800]]) {
      const { context, page } = await openPage(browser, { width, height });
      await visit(page, "/surf");
      const m = await page.evaluate((B) => {
        const box = eval(B);
        const title = document.querySelector(".page--surf .page-head__title, #main .page-head__title");
        const meta = document.querySelector("#main .page-head__meta");
        if (!title || !meta) return null;
        const probe = document.createElement("span");
        probe.style.color = "var(--color-text-secondary)";
        document.body.append(probe);
        const secondary = getComputedStyle(probe).color;
        probe.remove();
        return { title: box("#main .page-head__title"), meta: box("#main .page-head__meta"), text: meta.textContent, metaColor: getComputedStyle(meta).color, titleColor: getComputedStyle(title).color, secondary };
      }, BOX);
      if (!m) { fails.push(`${width}：标题或状态行不见了`); await context.close(); continue; }
      if (!/逛了/.test(m.text)) fails.push(`${width}：状态行文字是「${m.text}」`);
      const mid = m.meta.y + m.meta.h / 2;
      if (!(mid > m.title.y && mid < m.title.y + m.title.h)) fails.push(`${width}：状态行不在标题那一行（标题 y${m.title.y}–${m.title.y + m.title.h}，状态行中线 ${mid}）`);
      if (m.meta.x < m.title.x + m.title.w) fails.push(`${width}：状态行没在标题右边（x${m.meta.x} < ${m.title.x + m.title.w}）`);
      if (m.metaColor !== m.secondary) fails.push(`${width}：状态行颜色 ${m.metaColor}，应为次要文字色 ${m.secondary}`);
      if (m.metaColor === m.titleColor) fails.push(`${width}：状态行和标题同色`);
      detail += `${width} 标题右侧 +${m.meta.x - m.title.x - m.title.w}px；`;
      await context.close();
    }
    record("见闻页状态行在标题右侧同一行，用次要文字色（1440 / 1180 / 900）", fails.length === 0, fails.join("；") || detail);
  }

  // 46 设置页滚动：吸顶目录条横向盖住卡片列（含卡片 1px 描边和圆角）并伸进页面留白，不造成横向滚动；卡片滑过时被目录条盖住
  {
    const fails = [];
    let detail = "";
    for (const [width, height] of [[1440, 900], [1180, 780], [900, 800], [390, 844]]) {
      const { context, page } = await openPage(browser, { width, height });
      await visit(page, "/settings");
      const rows = [];
      for (const top of [400, 1100, 2000]) {
        rows.push(await page.evaluate((top) => {
          const s = document.querySelector(".page--settings");
          s.scrollTop = top;
          const nav = document.querySelector(".set-nav").getBoundingClientRect();
          const cards = [...document.querySelectorAll(".set-group")].map((g) => g.getBoundingClientRect());
          const card = cards[0];
          const under = cards.find((r) => r.top < nav.bottom && r.bottom > nav.bottom);
          const hits = [card.left + 1, card.left + card.width / 2, card.right - 1].map((x) => document.elementFromPoint(x, nav.top + nav.height / 2)?.closest(".set-nav") != null);
          return { st: s.scrollTop, over: s.scrollWidth - s.clientWidth, nav: [nav.left, nav.right, nav.top], card: [card.left, card.right], under: Boolean(under), hits };
        }, top));
      }
      for (const r of rows) {
        if (r.over > 0) fails.push(`${width} 滚到 ${r.st}：横向溢出 ${r.over}px`);
        if (!(r.nav[0] <= r.card[0] - 1 && r.nav[1] >= r.card[1] + 1)) fails.push(`${width} 滚到 ${r.st}：目录条 ${Math.round(r.nav[0])}–${Math.round(r.nav[1])} 没盖住卡片列 ${Math.round(r.card[0])}–${Math.round(r.card[1])} 的描边`);
        if (r.st > 0 && r.under && !r.hits.every(Boolean)) fails.push(`${width} 滚到 ${r.st}：卡片压在目录条上`);
      }
      detail += `${width} 条 ${Math.round(rows[1].nav[0])}–${Math.round(rows[1].nav[1])} / 卡 ${Math.round(rows[1].card[0])}–${Math.round(rows[1].card[1])}；`;
      await context.close();
    }
    record("设置页滚动时目录条盖住卡片列、不重叠、不横向溢出（1440 / 1180 / 900 / 390）", fails.length === 0, fails.join("；") || detail);
  }

  // 47 侧栏与往回翻的宽度：侧栏展开 200、里面的字都不截断；往回翻是窄栏（≤360、≤ 内容区 31%），窄窗抽屉从右侧出，打开时人物不被挤小
  {
    const fails = [];
    const notes = [];
    for (const [width, elder] of [[1440, false], [1180, false], [1180, true]]) {
      const { context, page } = await openPage(browser, { width, height: 800, elder });
      await visit(page, "/");
      const m = await page.evaluate(() => {
        const nav = document.querySelector(".shell-nav");
        const nr = nav.getBoundingClientRect();
        const bad = [];
        for (const e of nav.querySelectorAll(".shell-nav__brand strong, .shell-nav__brand small, .shell-nav__group-label, .shell-nav__label, .shell-nav__her-text strong, .shell-nav__her-text small, .shell-nav__toggle")) {
          const r = e.getBoundingClientRect();
          if (e.scrollWidth > e.clientWidth + 1 || r.right > nr.right - 1 || e.getClientRects().length > 1) bad.push(e.textContent.trim() || e.className);
        }
        return { w: Math.round(nr.width), bad };
      });
      const tag = `${width}${elder ? " 老人" : ""}`;
      const want = elder ? NAV_W * 1.25 : NAV_W; // 侧栏跟着字号放大，老人模式字号 1.25 倍
      if (m.w !== want) fails.push(`${tag}：侧栏 ${m.w}px，应为 ${want}`);
      if (m.bad.length) fails.push(`${tag}：侧栏里被截断或换行：${m.bad.join("、")}`);
      notes.push(`侧栏 ${tag} ${m.w}`);
      await context.close();
    }
    for (const [width, height, empty] of [[1920, 1000, true], [1440, 900, true], [1440, 900, false], [1180, 780, true], [1180, 780, false]]) {
      const { context, page } = await openPage(browser, { width, height });
      if (empty) await page.route("**/api/chat/history**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) }));
      await visit(page, "/");
      const open = page.getByRole("button", { name: "往回翻" });
      if (await open.count()) { await open.first().click(); await page.waitForTimeout(400); }
      const m = await page.evaluate((B) => { const box = eval(B); return { aside: box(".room__aside"), area: box("#main") }; }, BOX);
      const tag = `${width}${empty ? " 点开" : " 有对话"}`;
      if (!m.aside) { fails.push(`${tag}：往回翻右栏没打开`); await context.close(); continue; }
      const share = m.aside.w / m.area.w;
      if (m.aside.w > 360) fails.push(`${tag}：往回翻 ${m.aside.w}px，超过 360`);
      if (share > 0.31) fails.push(`${tag}：往回翻占内容区 ${(share * 100).toFixed(0)}%（${m.aside.w}/${m.area.w}），超过 31%`);
      if (empty && width <= 1440) {
        await page.waitForTimeout(800);
        const scene = await page.evaluate(() => { const s = document.querySelector(".scene"); return { h: s.getBoundingClientRect().height, safe: Number.parseFloat(getComputedStyle(s).getPropertyValue("--scene-safe")) || 0 }; });
        const art = await artExtent(page);
        const fill = art.r < 0 ? 0 : Math.max((art.b - art.t) / (scene.h - scene.safe), (art.r - art.l) / art.w);
        if (fill < 0.85) fails.push(`${tag}：右栏打开后人物只占 ${(fill * 100).toFixed(0)}%`);
        notes.push(`${tag} 右栏 ${m.aside.w}/${m.area.w}，人物 ${(fill * 100).toFixed(0)}%`);
      } else notes.push(`${tag} 右栏 ${m.aside.w}/${m.area.w}`);
      await context.close();
    }
    for (const [width, height] of [[900, 800], [390, 844]]) {
      const { context, page } = await openPage(browser, { width, height, touch: width === 390 });
      await visit(page, "/");
      await page.getByRole("button", { name: "往回翻" }).first().click();
      await page.waitForTimeout(500);
      const s = await page.evaluate((B) => eval(B)(".sheet"), BOX);
      if (!s) { fails.push(`${width}：往回翻抽屉没打开`); await context.close(); continue; }
      if (width === 900) {
        if (s.w > 360) fails.push(`900：抽屉 ${s.w}px，超过 360`);
        if (s.x + s.w !== width || s.y !== 0 || s.h !== height) fails.push(`900：抽屉应贴右侧满高，实际 ${s.w}×${s.h}@${s.x},${s.y}`);
      } else if (s.x !== 0 || s.w !== width) fails.push(`390：手机抽屉应横向铺满，实际 ${s.w}@${s.x}`);
      notes.push(`${width} 抽屉 ${s.w}×${s.h}@${s.x},${s.y}`);
      await context.close();
    }
    record("侧栏 200 不截断；往回翻 ≤360 且 ≤31%，900 右侧抽屉，打开时人物 ≥85%", fails.length === 0, fails.join("；") || notes.join("；"));
  }

  // 48 输入条按钮上下居中、语音挨着发送；侧栏收起按钮不单独占一行、收起前后不动
  {
    const fails = [];
    const notes = [];
    const COMPOSER = () => {
      const input = document.querySelector("#chat-input");
      const ir = input.getBoundingClientRect();
      const cs = getComputedStyle(input);
      const line = Number.parseFloat(cs.lineHeight);
      const lastLine = ir.bottom - Number.parseFloat(cs.paddingBottom) - line / 2;
      const btns = [...document.querySelectorAll(".composer__bar button")].filter((b) => b.getBoundingClientRect().width > 0);
      return {
        input: { l: ir.left, r: ir.right, c: ir.top + ir.height / 2, lastLine },
        btns: btns.map((b) => { const r = b.getBoundingClientRect(); return { name: b.getAttribute("aria-label") || b.textContent.trim(), l: r.left, r: r.right, c: r.top + r.height / 2 }; }),
      };
    };
    for (const [width, elder] of [[1440, false], [1180, false], [1180, true], [900, false], [390, false]]) {
      const { context, page } = await openPage(browser, { width, height: width === 390 ? 844 : 800, elder, touch: width === 390 });
      await visit(page, "/");
      const tag = `${width}${elder ? " 老人" : ""}`;
      const one = await page.evaluate(COMPOSER);
      const find = (m, n) => m.btns.find((b) => b.name === n);
      const video = find(one, "发个视频给她"), voice = find(one, "语音聊天"), send = find(one, "发送");
      if (!video || !voice || !send) { fails.push(`${tag}：找不到视频 / 语音 / 发送按钮（${one.btns.map((b) => b.name).join("、")}）`); await context.close(); continue; }
      for (const b of [video, voice, send]) {
        const d = b.c - one.input.c;
        if (Math.abs(d) > 1) fails.push(`${tag} 单行：「${b.name}」中心比输入框中心${d > 0 ? "低" : "高"} ${Math.abs(d).toFixed(1)}px`);
      }
      if (!(video.r <= one.input.l + 1)) fails.push(`${tag}：视频按钮不在输入框左边`);
      if (!(voice.l >= one.input.r - 1)) fails.push(`${tag}：语音按钮不在输入框右边`);
      const between = one.btns.filter((b) => b.l > voice.r - 1 && b.r < send.l + 1);
      if (send.l < voice.r || send.l - voice.r > 12 || between.length) fails.push(`${tag}：语音和发送不相邻（语音右 ${Math.round(voice.r)}，发送左 ${Math.round(send.l)}）`);
      await page.locator("#chat-input").fill("第一行\n第二行\n第三行");
      await page.waitForTimeout(300);
      const multi = await page.evaluate(COMPOSER);
      for (const b of multi.btns) {
        const d = b.c - multi.input.lastLine;
        if (Math.abs(d) > 1) fails.push(`${tag} 三行：「${b.name}」中心离最后一行 ${d.toFixed(1)}px`);
      }
      notes.push(`${tag} 单行差 ≤${Math.max(...[video, voice, send].map((b) => Math.abs(b.c - one.input.c))).toFixed(1)}px`);
      await context.close();
    }
    for (const [width, elder] of [[1440, false], [1180, false], [1180, true]]) {
      const { context, page } = await openPage(browser, { width, height: 800, elder });
      await visit(page, "/");
      const tag = `${width}${elder ? " 老人" : ""}`;
      const nav = () => page.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); const b = e?.getBoundingClientRect(); return b && b.width ? { l: b.left, r: b.right, t: b.top, b: b.bottom, c: b.top + b.height / 2 } : null; };
        return { toggle: r(".shell-nav__toggle"), mark: r(".shell-nav__mark"), her: r(".shell-nav__her"), nav: r(".shell-nav"), w: Math.round(document.querySelector(".shell-nav").getBoundingClientRect().width) };
      });
      const a = await nav();
      if (!a.toggle || !a.mark) { fails.push(`${tag}：找不到收起按钮或品牌标记`); await context.close(); continue; }
      if (Math.abs(a.toggle.c - a.mark.c) > 1 || a.mark.l < a.toggle.r) fails.push(`${tag}：收起按钮没和品牌标记并排（按钮中心 ${Math.round(a.toggle.c)}，标记中心 ${Math.round(a.mark.c)}）`);
      if (a.nav.b - a.her.b > 24) fails.push(`${tag}：她的卡片下面还空着 ${Math.round(a.nav.b - a.her.b)}px（收起按钮原来那一行）`);
      await page.mouse.click((a.toggle.l + a.toggle.r) / 2, a.toggle.c);
      await page.waitForTimeout(300);
      const b = await nav();
      if (b.w !== 72) fails.push(`${tag}：点了没收起（${b.w}）`);
      if (!b.toggle || Math.abs(a.toggle.l - b.toggle.l) > 0.5 || Math.abs(a.toggle.t - b.toggle.t) > 0.5) fails.push(`${tag}：收起后按钮从 (${Math.round(a.toggle.l)},${Math.round(a.toggle.t)}) 挪到 (${Math.round(b.toggle?.l)},${Math.round(b.toggle?.t)})`);
      else if (b.toggle.r > 72) fails.push(`${tag}：收起按钮超出 72 窄栏`);
      await page.mouse.click((a.toggle.l + a.toggle.r) / 2, a.toggle.c);
      await page.waitForTimeout(300);
      if ((await nav()).w !== a.w) fails.push(`${tag}：原地再点没展开`);
      notes.push(`${tag} 收起按钮 (${Math.round(a.toggle.l)},${Math.round(a.toggle.t)}) 两态一致`);
      await context.close();
    }
    record("输入条按钮上下居中、语音挨着发送；收起按钮在品牌行、收起前后不动", fails.length === 0, fails.join("；") || notes.join("；"));
  }

  // 49 弹层关上后焦点回到打开它的按钮：往回翻抽屉（900 / 390 × Escape / 「关上」）、设置页「换一位」（Escape / ✕）
  {
    const fails = [];
    const notes = [];
    const focused = () => {
      const el = document.activeElement;
      return el && el !== document.body ? `${el.tagName}「${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 8)}」` : "BODY";
    };
    // 用键盘打开：先把焦点放到按钮上再回车，跟读屏 / 键盘用户的路径一致
    const openBy = async (page, trigger) => {
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(350);
    };
    for (const [width, height, touch] of [[900, 760, false], [390, 844, true]]) {
      for (const how of ["Escape", "关上"]) {
        const { context, page } = await openPage(browser, { width, height, touch });
        await visit(page, "/");
        const trigger = page.locator(".mbar").getByRole("button", { name: "往回翻" });
        await openBy(page, trigger);
        const sheet = page.locator(".sheet");
        if (!(await sheet.isVisible())) { fails.push(`${width}：往回翻没打开`); await context.close(); continue; }
        if (how === "Escape") await page.keyboard.press("Escape");
        else await sheet.getByRole("button", { name: "关上" }).click();
        await page.waitForTimeout(350);
        const back = await trigger.evaluate((el) => el === document.activeElement);
        if (!back) fails.push(`${width} 往回翻 ${how} 关上后焦点在 ${await page.evaluate(focused)}`);
        else notes.push(`${width} 往回翻 ${how} 回焦`);
        await context.close();
      }
    }
    for (const how of ["Escape", "关闭"]) {
      const { context, page } = await openPage(browser, { width: 1180, height: 820 });
      await visit(page, "/settings");
      const trigger = page.getByRole("button", { name: "换一位" });
      await openBy(page, trigger);
      const dialog = page.getByRole("dialog");
      if (!(await dialog.isVisible())) { fails.push("换一位没打开"); await context.close(); continue; }
      if (how === "Escape") await page.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "关闭" }).first().click();
      await page.waitForTimeout(350);
      const back = await trigger.evaluate((el) => el === document.activeElement);
      if (!back) fails.push(`换一位 ${how} 关上后焦点在 ${await page.evaluate(focused)}`);
      else notes.push(`换一位 ${how} 回焦`);
      await context.close();
    }
    record("弹层关上后焦点回到触发按钮（往回翻 900 / 390 × Escape / 关上；换一位 Escape / ✕）", fails.length === 0, fails.join("；") || notes.join("；"));
  }
}

/** 只留 Live2D 画布在白底上截几帧，量出看得见的像素外框（取并集，覆盖待机动作摆到最开）。 */
async function artExtent(page) {
  const css = await page.addStyleTag({ content: "body *{visibility:hidden!important}.scene canvas{visibility:visible!important}html,body{background:#fff!important}" });
  const out = { l: Infinity, r: -1, t: Infinity, b: -1, w: 0, h: 0 };
  for (let i = 0; i < 6; i++) {
    const png = (await page.locator(".scene canvas").first().screenshot()).toString("base64");
    const b = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let l = Infinity, r = -1, t = Infinity, bottom = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const k = (y * c.width + x) * 4;
        if (765 - d[k] - d[k + 1] - d[k + 2] > 60) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > bottom) bottom = y; }
      }
      return { l, r, t, b: bottom, w: c.width, h: c.height };
    }, png);
    out.l = Math.min(out.l, b.l); out.r = Math.max(out.r, b.r); out.t = Math.min(out.t, b.t); out.b = Math.max(out.b, b.b); out.w = b.w; out.h = b.h;
    await page.waitForTimeout(350);
  }
  await css.evaluate((el) => el.remove());
  return out;
}

async function checkMobileKeyboard(browser) {
  const fails = [];
  const details = [];
  for (const width of [390, 720, 900]) {
    const { context, page } = await openPage(browser, { width, height: 844, touch: width === 390 });
    await visit(page, "/");
    const before = await page.evaluate(() => Math.round(document.querySelector(".app-shell")?.getBoundingClientRect().height ?? -1));
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 480 });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
      };
      return {
        kb: document.documentElement.dataset.kb,
        vvh: getComputedStyle(document.documentElement).getPropertyValue("--vvh").trim(),
        shell: box(".app-shell"),
        main: box(".app-shell__main"),
        composer: box(".composer"),
        input: box(".composer__input"),
        send: box(".composer__send"),
      };
    });
    await context.close();

    if (m.kb !== "on" || m.vvh !== "480px") fails.push(`${width}px 键盘状态 ${m.kb}/${m.vvh || "无 --vvh"}，应为 on/480px`);
    if (m.shell?.bottom !== 480) fails.push(`${width}px 外壳高 ${m.shell?.bottom}px，应为 480`);
    if (width >= 720) {
      if (!m.main) fails.push(`${width}px 主栏不存在`);
      else if (m.main.left !== 0 || m.main.width !== width) fails.push(`${width}px 主栏 ${m.main.left}–${m.main.right}（${m.main.width}px），应占满 ${width}px`);
    }
    for (const [name, b] of [["输入区", m.composer], ["输入框", m.input], ["发送键", m.send]]) {
      if (!b) fails.push(`${width}px ${name}不存在`);
      else if (b.top < 0 || b.bottom > 480) fails.push(`${width}px ${name} ${b.top}–${b.bottom}，超出 0–480`);
    }
    details.push(`${width}px：外壳 ${before}→${m.shell?.bottom}，主栏 ${m.main?.left}–${m.main?.right}（${m.main?.width}），发送键底 ${m.send?.bottom}`);
  }
  return record("键盘弹起：外壳 480px，720/900 主栏占满宽度，输入框与发送键在可视区内", fails.length === 0, fails.length ? fails.join("；") : details.join("；"));
}

/** 32. 聊天几何：scene-safe 不压小可画区；390 的输入条必须在底栏上方。 */
async function checkChatGeometry(browser) {
  const fails = [];
  const notes = [];
  const baseline = {
    1440: { done: 452, thinking: 444, failed: 395 },
    900: { done: 378, thinking: 378, failed: 378 },
    390: { done: 323, thinking: 346, failed: 299 },
  };
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  for (const width of [1440, 900, 390]) {
    for (const state of ["done", "thinking", "failed"]) {
      const { context, page } = await openPage(browser, { width, height: width === 390 ? 844 : 900, touch: width === 390 });
      await page.route("**/api/chat/sessions**", (route) => json(route, FIXTURES.chatSessions));
      let sent = 0;
      if (state === "thinking") await page.route(/\/api\/chat$/, () => { sent += 1; return new Promise(() => {}); });
      if (state === "failed") await page.route(/\/api\/chat$/, (route) => { sent += 1; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "stub failure" }) }); });
      await visit(page, "/");
      if (state !== "done") {
        // 触屏（390）下 Enter 只换行，所以统一点发送键；再确认请求发出、目标状态真的出现，免得量到的是 idle 的尺寸。
        await page.locator("#chat-input").fill("测试消息");
        await page.locator(".composer__send").click();
        const reached = await page.locator(`.dlg[data-state="${state}"]`).waitFor({ timeout: 5000 }).then(() => true, () => false);
        if (sent !== 1) fails.push(`${width} ${state} /api/chat 发出 ${sent} 次，应为 1 次`);
        if (!reached) fails.push(`${width} ${state} 没进入 ${state} 状态`);
        await page.waitForTimeout(800);
      }
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const rect = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) } : null;
        };
        const scene = document.querySelector(".scene");
        return {
          scene: rect(".scene"),
          composer: rect(".composer"),
          nav: rect(".shell-nav"),
          safe: scene ? Number.parseFloat(getComputedStyle(scene).getPropertyValue("--scene-safe")) || 0 : 0,
          viewport: innerHeight,
        };
      });
      await context.close();
      const tag = `${width} ${state}`;
      if (!m.scene || !m.composer) {
        fails.push(`${tag} 找不到舞台或输入区`);
        continue;
      }
      const drawable = m.scene.height - m.safe;
      const min = baseline[width][state];
      if (drawable < min - 1) fails.push(`${tag} 可画区 ${drawable}px < 基线 ${min}px`);
      if (m.composer.bottom > m.viewport) fails.push(`${tag} 输入区底部 ${m.composer.bottom} > 视口 ${m.viewport}`);
      if (width === 390 && m.nav && m.composer.bottom > m.nav.top) fails.push(`${tag} 输入区底部 ${m.composer.bottom} > 底栏 ${m.nav.top}`);
      if (width !== 1440) {
        const bottom = width === 390 ? m.nav?.top ?? m.viewport : m.viewport;
        if (m.composer.bottom < bottom - 16) fails.push(`${tag} 输入区底部 ${m.composer.bottom} 未贴近底部 ${bottom}（差 ${bottom - m.composer.bottom}px）`);
      }
      notes.push(`${tag} 可画区 ${drawable}/${min}，输入条 ${m.composer.bottom}${width === 390 ? `/底栏 ${m.nav?.top}` : ""}`);
    }
  }
  return record("聊天几何：3 档宽度 × done/thinking/failed 可画区不低于 225e9e3；390 输入条不压底栏", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
}

/** 33. 聊天紧凑浮层：焦点进入、Escape 关闭、关闭回焦，done 时 sr-only 全文常驻。 */
async function checkChatThreadFocus(browser) {
  const fails = [];
  const notes = [];
  for (const width of [900, 390]) {
    const { context, page } = await openPage(browser, { width, height: width === 390 ? 844 : 900, touch: width === 390 });
    await page.route("**/api/chat/sessions**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURES.chatSessions) }));
    await visit(page, "/");
    const peek = page.getByRole("button", { name: /最近的 \d+ 条/ });
    if ((await peek.count()) === 0) {
      fails.push(`${width} 找不到「最近的 N 条」按钮`);
      await context.close();
      continue;
    }
    const status = (await page.locator('.dlg[data-state="done"] [role="status"]').textContent())?.trim() ?? "";
    if (!status.includes("我把昨天看到的那个视频写成了日记")) fails.push(`${width} done 收起时没有 sr-only 全文播报（「${status}」）`);
    await peek.click();
    await page.waitForTimeout(150);
    const opened = await page.locator(".chat-thread--compact").count();
    const focusInside = await page.evaluate(() => Boolean(document.querySelector(".chat-thread--compact")?.contains(document.activeElement)));
    if (opened !== 1) fails.push(`${width} 点开后没有浮层`);
    if (!focusInside) fails.push(`${width} 打开后焦点没有进入浮层`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const stillOpen = await page.locator(".chat-thread--compact").count();
    const back = await page.evaluate(() => document.activeElement?.classList.contains("chat-thread__peek") ?? false);
    if (stillOpen !== 0) fails.push(`${width} Escape 没有关闭浮层`);
    if (!back) fails.push(`${width} 关闭后焦点没有回到「最近的 N 条」`);
    notes.push(`${width} 焦点进入/Escape 关闭/回焦；播报 ${status.length} 字`);
    await context.close();
  }
  return record("聊天紧凑浮层：焦点进入、Escape 关闭、关闭回焦；done sr-only 全文常驻", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
}

/** 50. 往回翻右栏默认收起，回复生成完也不自动展开；消息留在主区底部，手动打开能看到刚生成的那条。 */
async function checkBacklogStaysClosed(browser) {
  const fails = [];
  const notes = [];
  const reply = "收到啦，这条是刚生成的回复。";
  for (const [width, height] of [[1440, 900], [1180, 800], [900, 800], [390, 844]]) {
    const { context, page } = await openPage(browser, { width, height, touch: width === 390 });
    await page.route(/\/api\/chat$/, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: ev("ack", { sessionId: "s1" }) + ev("emotion", { emotion: "happy" }) + ev("delta", { text: reply }) + ev("done", { messageId: 99, sessionId: "s1", emotion: "happy" }),
      });
    });
    await visit(page, "/");
    const tag = String(width);
    const panel = () => page.evaluate(() => {
      const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none"; };
      return { aside: visible(document.querySelector(".room__aside")), sheet: visible(document.querySelector(".sheet")), state: document.querySelector(".room")?.getAttribute("data-backlog") };
    });
    const before = await panel();
    if (before.aside || before.sheet || before.state !== "closed") fails.push(`${tag} 进页面右栏就在（aside ${before.aside} / sheet ${before.sheet} / ${before.state}）`);
    await page.locator("#chat-input").fill("测试消息");
    await page.locator(".composer__send").click();
    const done = await page.locator('.dlg[data-state="done"]').waitFor({ timeout: 5000 }).then(() => true, () => false);
    if (!done) fails.push(`${tag} 回复没走到 done`);
    await page.waitForTimeout(1500);
    const after = await panel();
    if (after.aside || after.sheet || after.state !== "closed") fails.push(`${tag} 回复生成完右栏自动展开了（aside ${after.aside} / sheet ${after.sheet} / ${after.state}）`);
    const dock = await page.evaluate(() => {
      const dlg = document.querySelector(".dlg"); const scene = document.querySelector(".scene"); const composer = document.querySelector(".composer");
      if (!dlg || !scene || !composer) return null;
      const d = dlg.getBoundingClientRect(); const c = composer.getBoundingClientRect(); const s = scene.getBoundingClientRect();
      return { text: dlg.textContent ?? "", top: Math.round(d.top), bottom: Math.round(d.bottom), composerTop: Math.round(c.top), sceneMid: Math.round(s.top + s.height / 2), vh: innerHeight };
    });
    if (!dock) fails.push(`${tag} 找不到底部展示区`);
    else {
      if (!dock.text.includes(reply)) fails.push(`${tag} 回复没有留在底部展示区`);
      if (dock.top < dock.sceneMid || dock.bottom > dock.vh) fails.push(`${tag} 展示区不在主区下半部（${dock.top}-${dock.bottom}，视口 ${dock.vh}）`);
    }
    await page.getByRole("button", { name: "往回翻" }).first().click();
    await page.waitForTimeout(500);
    const panelSel = width >= 960 ? ".room__aside" : ".sheet";
    const opened = await panel();
    if (!(width >= 960 ? opened.aside : opened.sheet)) fails.push(`${tag} 点「往回翻」后没有展开`);
    else {
      const text = (await page.locator(panelSel).textContent()) ?? "";
      if (!text.includes(reply)) fails.push(`${tag} 展开后看不到刚生成的那条`);
      if (!text.includes("刚下班，有点累")) fails.push(`${tag} 展开后看不到更早的历史`);
      await page.getByRole("button", { name: width >= 960 ? "收起" : "关上", exact: true }).first().click();
      await page.waitForTimeout(500);
      const closed = await panel();
      if (closed.aside || closed.sheet) fails.push(`${tag} 点「${width >= 960 ? "收起" : "关上"}」后没有收起`);
    }
    notes.push(`${tag} 默认收起 → 回复完仍收起 → 点开有刚生成的那条 → 收起`);
    await context.close();
  }
  return record("往回翻右栏默认收起，回复生成完不自动展开；点开看得到刚生成的那条，能收起（1440 / 1180 / 900 / 390）", fails.length === 0, fails.join("；") || notes.join("；"));
}

/** 33. 日记月/年导航：900 与 390 老人模式都不把「回到今天」孤立或挤掉年份。 */
async function checkDiaryNav(browser) {
  const fails = [];
  const notes = [];
  for (const [width, elder] of [[900, false], [390, true]]) {
    const { context, page } = await openPage(browser, { width, height: 900, elder });
    await visit(page, "/diary");
    for (const mode of ["月", "年"]) {
      await page.getByRole("tab", { name: mode }).click();
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null;
        };
        const bar = document.querySelector(".pagebar");
        return { jump: box(".pagebar__jump"), today: box(".pagebar__today"), bar: bar ? { w: Math.round(bar.clientWidth), scroll: Math.round(bar.scrollWidth), h: Math.round(bar.getBoundingClientRect().height) } : null };
      });
      const tag = `${width}${elder ? " 老人" : ""} ${mode}`;
      if (!m.jump || m.jump.w < 40 || m.jump.h < 24) fails.push(`${tag} 跳转控件不可见：${JSON.stringify(m.jump)}`);
      if (!m.today || m.today.w < 40) fails.push(`${tag} 回到今天不可见：${JSON.stringify(m.today)}`);
      if (!m.bar || m.bar.scroll > m.bar.w + 1) fails.push(`${tag} 时间导航横向溢出 ${m.bar?.scroll}/${m.bar?.w}`);
      notes.push(`${tag} 跳转 ${m.jump?.w}×${m.jump?.h}，今日 ${m.today?.w}，栏高 ${m.bar?.h}`);
    }
    await context.close();
  }
  return record("日记月/年导航：900 与 390 老人模式跳转/今日可见、无横向溢出", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
}

/** 30. 手机底栏文字：719px 及以下不能沿用 1179px 以下的隐藏规则。 */
async function checkMobileTabLabels(browser) {
  const fails = [];
  const notes = [];
  for (const [width, elder] of [[390, false], [719, false], [390, true]]) {
    const { context, page } = await openPage(browser, { width, height: 900, touch: true, elder });
    await visit(page, "/settings");
    const m = await page.evaluate(() => ({
      items: document.querySelectorAll(".shell-nav__item").length,
      labels: [...document.querySelectorAll(".shell-nav__label")].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), display: getComputedStyle(el).display, w: Math.round(r.width), h: Math.round(r.height) };
      }),
    }));
    await context.close();
    const tag = `${width}${elder ? " 老人" : ""}`;
    if (m.items !== m.labels.length) fails.push(`${tag} 有 ${m.items} 个入口，只找到 ${m.labels.length} 个标签`);
    const hidden = m.labels.filter((l) => l.display === "none" || l.w === 0 || l.h === 0);
    if (hidden.length) fails.push(`${tag} 标签不可见：${hidden.map((l) => l.text).join("、")}`);
    notes.push(`${tag} ${m.labels.length}/${m.items}`);
  }
  return record("手机底栏：719px 及以下文字标签可见（含老人模式）", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
}

/** 31. 老人模式图标栏：72px 列里链接至少 56×56（自动收起与 1440 手动收起都要过）。 */
async function checkElderRailTargets(browser) {
  const fails = [];
  const notes = [];
  for (const width of [900, 720, 1440]) {
    const { context, page } = await openPage(browser, { width, height: 900, elder: true });
    await visit(page, "/settings");
    if (width === 1440) {
      await page.getByRole("button", { name: "收起导航" }).click();
      await page.waitForTimeout(200);
    }
    const m = await page.evaluate(() => ({
      nav: Math.round(document.querySelector(".shell-nav").getBoundingClientRect().width),
      links: [...document.querySelectorAll(".shell-nav__item")].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.getAttribute("aria-label"), w: Math.round(r.width), h: Math.round(r.height) };
      }),
    }));
    await context.close();
    for (const link of m.links) {
      if (link.w < 56 || link.h < 56) fails.push(`${width}px「${link.text}」${link.w}×${link.h}，小于 56×56`);
    }
    const minW = Math.min(...m.links.map((l) => l.w));
    const minH = Math.min(...m.links.map((l) => l.h));
    notes.push(`${width} ${m.nav}px 栏 ${minW}×${minH}`);
  }
  return record("老人模式图标栏：900 / 720 / 1440 收起后链接 ≥56×56", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
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
  const toast = await page.waitForSelector(".ui-toast", { timeout: 3000 }).catch(() => null);
  let toastNote = "没弹出";
  if (!toast) fails.push("surf 点「让她现在去逛逛」后没有便签");
  else {
    const box = await toast.evaluate((el) => ({ position: getComputedStyle(el.closest(".ui-toast__viewport") ?? el).position, width: Math.round(el.getBoundingClientRect().width) }));
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
  // 公共组件行为（/__kit 的「不可用时不触发」区）：loading / aria-disabled 按钮点了、回车了都不提交不回调；
  // 每个字段标签都连到控件，控件自带 id 时连到它
  await visit(p2, "/__kit");
  const guard = p2.locator("#uikit-guard").locator("..");
  for (const name of ["提交中", "暂不可用", "暂不可用的图标按钮"]) await guard.getByRole("button", { name, exact: true }).click({ force: true }); // aria-disabled 在 Playwright 眼里是禁用，要强点
  await guard.locator("#kit-own-id").press("Enter");
  const count = (await p2.locator("#kit-guard-count").textContent())?.trim() ?? "";
  if (count !== "提交 0 次，点击 0 次") fails.push(`kit 不可用按钮仍触发了：${count}`);
  const labels = await p2.evaluate(() => [...document.querySelectorAll("label.ui-field__label")].map((l) => ({ text: (l.textContent || "").trim(), control: l.control?.id ?? null })));
  for (const l of labels.filter((l) => !l.control)) fails.push(`kit 字段「${l.text}」的标签没连到控件`);
  const own = labels.find((l) => l.text === "自带 id 的输入框");
  if (own?.control !== "kit-own-id") fails.push(`kit 自带 id 的字段标签指向 ${own?.control ?? "无"}`);
  await c2.close();
  return record("懒加载页共享样式 / 标签面板指向 / 不可用按钮 / 字段标签", fails.length === 0, fails.length ? fails.join("；") : `surf 便签 ${toastNote}；${tabs} 个标签无悬空 aria-controls，面板都有标签指向；不可用按钮 3 个点击 + 回车：${count}；${labels.length} 个字段标签都连到控件`);
}

/** 17. 记忆页 / 见闻页按 astryx 模式重做：用的是 components/ui（Tabs / Card / Dialog / ConfirmDialog），没有旧的手账卡；点条目开详情，忘掉要二次确认。 */
async function checkMemorySurfPages(browser) {
  const fails = [];
  const notes = [];
  for (const [label, path, opener, tabsMin] of [["记忆页", "/memory", "[data-memory-card]", 1], ["见闻页", "/surf", "[data-surf-open]", 1]]) {
    for (const width of [1440, 900]) {
      const { context, page } = await openPage(browser, { width, height: 900 });
      await visit(page, path);
      const tag = `${label}@${width}`;
      const have = await page.evaluate((opener) => ({
        tabs: document.querySelectorAll(".ui-tabs").length,
        cards: document.querySelectorAll(".ui-card").length,
        items: document.querySelectorAll(opener).length,
        old: document.querySelectorAll(".mcard, .postcard, .postcard-card, .tape").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }), opener);
      if (have.tabs < tabsMin) fails.push(`${tag} 没有 ui Tabs`);
      if (have.cards < 1) fails.push(`${tag} 没有 ui Card`);
      if (have.items < 1) fails.push(`${tag} 没有可点的条目`);
      if (have.old) fails.push(`${tag} 还有 ${have.old} 个旧手账卡元素`);
      if (have.overflow > 0) fails.push(`${tag} 横向溢出 ${have.overflow}px`);
      if (width === 1440) {
        await page.locator(opener).first().click();
        const dialog = await page.waitForSelector(".ui-dialog", { timeout: 3000 }).catch(() => null);
        if (!dialog) fails.push(`${tag} 点条目没有打开 ui Dialog`);
        else {
          await page.getByRole("button", { name: /^忘掉/ }).first().click().catch(() => {});
          const confirm = await page.getByRole("alertdialog").count();
          if (!confirm) fails.push(`${tag} 点「忘掉」后没有二次确认`);
        }
      }
      notes.push(`${tag} 条目 ${have.items}`);
      await context.close();
    }
  }
  return record("记忆页 / 见闻页用 ui 组件（Tabs / Card / Dialog / 确认框），无旧手账卡", fails.length === 0, fails.length ? fails.join("；") : notes.join("、"));
}

/** 18. 记忆页返工（初审 8 条）：撤回跟删除同生共死 / 切页结算 / 空分类有空态 / ✕ ≥44 / 弹层关闭焦点回到触发处 / 老人模式日期格不叠 / 危险入口是描边且靠左。 */
async function checkMemoryRework(browser) {
  const fails = [];
  const notes = [];
  const sleep = (page, ms) => page.waitForTimeout(ms);
  const openDetail = async (page, text) => {
    await page.locator("[data-memory-card]", { hasText: text }).first().click();
    await page.waitForSelector(".ui-dialog", { timeout: 3000 });
  };
  const forgetFromDetail = async (page, text) => {
    await openDetail(page, text);
    await page.locator(".ui-dialog").getByRole("button", { name: "忘掉这条" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "忘掉这条" }).click();
    await page.waitForSelector(".ui-toast", { timeout: 4000 });
  };

  // ---- 桌面 1440 ----
  {
    const { context, page } = await openPage(browser, { width: 1440, height: 900 });
    const deletes = [];
    page.on("request", (r) => { if (r.method() === "DELETE" && r.url().includes("/api/memories/")) deletes.push(decodeURIComponent(r.url().split("/").pop())); });
    await visit(page, "/memory");

    // 8. 条数只出现一处：页头不再写条数（说明行已删），总数只在「全部」标签上
    const head = await page.evaluate(() => ({
      meta: document.querySelectorAll(".page-head__meta").length,
      text: document.querySelector(".page-head")?.textContent ?? "",
      all: [...document.querySelectorAll(".mfilters__tabs [role=tab]")].find((t) => t.textContent.trim().startsWith("全部"))?.querySelector(".mfilters__n")?.textContent ?? "",
    }));
    if (head.meta) fails.push("记忆页头部还有右上角计数");
    if (/\d+ 条/.test(head.text)) fails.push(`记忆页页头还写着条数：${head.text.slice(0, 40)}`);
    if (!/^\d+$/.test(head.all.trim())) fails.push(`「全部」标签上没有总数（${head.all}）`);

    // 6. 详情里危险入口：描边（非实心）、靠左，安全动作在右
    await openDetail(page, "海边捡到玻璃");
    const foot = await page.evaluate(() => {
      const f = [...document.querySelectorAll(".ui-dialog button")].find((b) => b.textContent.trim() === "忘掉这条");
      const link = [...document.querySelectorAll(".ui-dialog a")].find((a) => a.textContent.trim() === "回到当时的聊天");
      if (!f || !link) return null;
      const cs = getComputedStyle(f);
      return { outline: f.classList.contains("ui-btn--danger-outline"), bg: cs.backgroundColor, left: f.getBoundingClientRect().left, linkLeft: link.getBoundingClientRect().left };
    });
    if (!foot) fails.push("详情里没找到「忘掉这条」和「回到当时的聊天」");
    else {
      if (!foot.outline || !/rgba\(0, 0, 0, 0\)|transparent/.test(foot.bg)) fails.push(`「忘掉这条」还是实心：${foot.bg}`);
      if (!(foot.left < foot.linkLeft)) fails.push("危险入口没在安全动作左边");
    }
    // 4. 关详情后焦点回到点开的那一行
    await page.keyboard.press("Escape");
    await sleep(page, 400);
    const back = await page.evaluate(() => document.activeElement?.hasAttribute("data-memory-card") ? (document.activeElement.textContent ?? "").slice(0, 8) : `落在 ${document.activeElement?.tagName}`);
    if (!back.includes("海边捡到")) fails.push(`关闭详情后焦点：${back}`);
    // 4. 日期弹层
    const dateBtn = page.getByRole("button", { name: /时间不限/ });
    await dateBtn.click();
    await page.waitForSelector(".ui-dialog", { timeout: 3000 });
    await page.keyboard.press("Escape");
    await sleep(page, 400);
    const dateBack = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
    if (dateBack !== "时间不限") fails.push(`关闭日期弹层后焦点：${dateBack || document.activeElement}`);
    // 4. 确认框取消后焦点回到「忘掉这条」
    await openDetail(page, "海边捡到玻璃");
    await page.locator(".ui-dialog").getByRole("button", { name: "忘掉这条" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "先留着" }).click();
    await sleep(page, 400);
    const cancelBack = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
    if (cancelBack !== "忘掉这条") fails.push(`取消确认后焦点：${cancelBack}`);
    await page.keyboard.press("Escape");
    await sleep(page, 400);

    // 2. 计数为 0 的分类有空态
    const emptyTab = page.getByRole("tab", { name: /她学到的/ });
    await emptyTab.click();
    const emptyText = await page.locator(".spanel").first().innerText().catch(() => "");
    if (!emptyText.includes("这个分类还没有记忆") || !emptyText.includes("清掉筛选")) fails.push(`空分类没有空态：${emptyText.slice(0, 30) || "空白"}`);
    await page.getByRole("tab", { name: /^全部/ }).click();

    // 3. 搜索清空按钮 ≥44
    await page.getByRole("searchbox").or(page.locator("#mem-search")).first().fill("玻璃");
    const clearBox = await page.locator(".ptool__clear").boundingBox();
    if (!clearBox || clearBox.width < 44 || clearBox.height < 44) fails.push(`清空 ✕ 只有 ${clearBox ? `${Math.round(clearBox.width)}×${Math.round(clearBox.height)}` : "没出现"}`);
    await page.locator(".ptool__clear").click();

    // 1a. 悬停超过 5 秒：撤回还在、DELETE 还没发
    await forgetFromDetail(page, "你说累的时候");
    await page.locator(".ui-toast").first().hover();
    await sleep(page, 6500);
    const stillUndo = await page.getByRole("button", { name: "撤回" }).count();
    if (!stillUndo) fails.push("悬停 6.5 秒后撤回按钮没了");
    if (deletes.length) fails.push(`悬停期间 DELETE 已发出：${deletes.join(",")}`);
    // 1b. 移开后吐司走，DELETE 才发，且只发一次
    await page.mouse.move(5, 5);
    await page.waitForSelector(".ui-toast", { state: "detached", timeout: 9000 }).catch(() => fails.push("移开后吐司没收起"));
    await sleep(page, 300);
    if (deletes.length !== 1) fails.push(`吐司走后 DELETE ${deletes.length} 次（应为 1）`);
    notes.push(`悬停 6.5s 撤回仍在、DELETE 0 → 吐司走后 ${deletes.length}`);

    // 1c. 撤回：行回来、不发 DELETE
    deletes.length = 0;
    await forgetFromDetail(page, "你下班回家");
    await page.getByRole("button", { name: "撤回" }).click();
    await sleep(page, 6500);
    const rowBack = await page.locator("[data-memory-card]", { hasText: "你下班回家" }).count();
    if (!rowBack) fails.push("点撤回后那一条没回来");
    if (deletes.length) fails.push(`撤回后仍发了 DELETE：${deletes.join(",")}`);
    notes.push(`撤回后行回来、DELETE ${deletes.length}`);

    // 1e. 折叠动画（240ms）没走完就关吐司，DELETE 立刻 500：错误提示出来，条目必须还在，不能被没取消的折叠定时器又藏起来
    {
      const fail500 = (route) => (route.request().method() === "DELETE" ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }) : route.fallback());
      await page.route("**/api/memories/**", fail500);
      deletes.length = 0;
      const key = "你下班回家";
      await openDetail(page, key);
      await page.locator(".ui-dialog").getByRole("button", { name: "忘掉这条" }).click();
      const closedAt = await page.evaluate(async () => {
        const t0 = performance.now();
        document.querySelector('[role="alertdialog"] button.ui-btn--danger')?.click();
        let close = null;
        while (!close && performance.now() - t0 < 1000) {
          close = [...document.querySelectorAll(".ui-toast button")].find((b) => b.textContent.trim() === "关掉");
          if (!close) await new Promise((r) => requestAnimationFrame(r));
        }
        close?.click();
        return close ? Math.round(performance.now() - t0) : -1;
      });
      if (closedAt < 0) fails.push("1e 没找到吐司的「关掉」");
      else if (closedAt >= 200) fails.push(`1e 关吐司用了 ${closedAt}ms，没赶在折叠结束前`);
      await page.getByText("没能忘掉").first().waitFor({ timeout: 3000 }).catch(() => fails.push("1e 没出现「没能忘掉」"));
      await sleep(page, 600);
      const kept = await page.locator("[data-memory-card]", { hasText: key }).count();
      if (!kept) fails.push("DELETE 失败后条目仍被藏着");
      if (deletes.length !== 1) fails.push(`1e DELETE ${deletes.length} 次（应为 1）`);
      notes.push(`折叠中关吐司 ${closedAt}ms、DELETE 失败后条目${kept ? "还在" : "不见了"}`);
      await page.unroute("**/api/memories/**", fail500);
      deletes.length = 0;
    }

    // 1d. 切页：吐司随页面走，删除在切页时结算，不留着一个失效的「撤回」
    await forgetFromDetail(page, "你不太喜欢在晚上做决定");
    await page.locator('a[href="/surf"]').first().click();
    await page.waitForSelector("[data-surf-open]", { timeout: 4000 });
    await sleep(page, 600);
    const leftover = await page.getByRole("button", { name: "撤回" }).count();
    if (leftover) fails.push("切到见闻页后撤回按钮还在");
    if (deletes.length !== 1) fails.push(`切页后 DELETE ${deletes.length} 次（应为 1）`);
    notes.push(`切页后无残留撤回、DELETE ${deletes.length}`);
    await context.close();
  }

  // ---- 老人模式 390：日期格不叠 ----
  {
    const { context, page } = await openPage(browser, { width: 390, height: 844, elder: true });
    await visit(page, "/memory");
    await page.getByRole("button", { name: /时间不限/ }).click();
    await page.waitForSelector(".mdate .mini__cell", { timeout: 3000 });
    const cells = await page.evaluate(() => {
      const rows = new Map();
      for (const el of document.querySelectorAll(".mdate .mini__grid .mini__cell")) {
        const r = el.getBoundingClientRect();
        const key = Math.round(r.top);
        (rows.get(key) ?? rows.set(key, []).get(key)).push([r.left, r.right]);
      }
      let overlap = 0;
      for (const row of rows.values()) for (let i = 1; i < row.length; i++) if (row[i][0] < row[i - 1][1] - 0.5) overlap++;
      const cal = document.querySelector(".mdate__cal");
      return { overlap, scroll: cal ? cal.scrollWidth > cal.clientWidth : null, rows: rows.size };
    });
    if (cells.overlap) fails.push(`老人模式 390 日期格重叠 ${cells.overlap} 处`);
    notes.push(`老人 390 日期格重叠 ${cells.overlap} 处（${cells.rows} 行，${cells.scroll ? "横向滚动" : "放得下"}）`);
    await context.close();
  }
  return record("记忆页返工：撤回与删除同步 / 空分类 / ✕ 尺寸 / 焦点回退 / 老人日期格 / 危险入口", fails.length === 0, fails.length ? fails.map((f) => f.slice(0, 80)).join("；") : notes.join("；"));
}

// 好感度卡（#159）：升级动画能播完、能跳过；减少动态时只淡入，连升也按时落到新卡面
/** 卡上的定时器全部登记下来，竞态检查要能「先跳过、再执行已到点的那个回调」。 */
const TIMER_SPY = () => {
  const timers = (window.__cardTimers = []);
  const set = window.setTimeout.bind(window);
  const clear = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...rest) => {
    const entry = { fn, ms: Number(ms) || 0, cleared: false, fired: false };
    entry.id = set(() => { entry.fired = true; fn(...rest); }, ms);
    if (typeof fn === "function" && entry.ms >= 300) timers.push(entry);
    return entry.id;
  };
  window.clearTimeout = (id) => {
    for (const t of timers) if (t.id === id) t.cleared = true;
    clear(id);
  };
};

/** 记下舞台卡 data-upgrading 的变化顺序，用来断言逐档快进。 */
const WATCH_STAGE = () => {
  const card = document.querySelector(".cardkit__stage .acard");
  window.__upSeq = [];
  new MutationObserver(() => {
    const v = card.getAttribute("data-upgrading");
    if (v && window.__upSeq[window.__upSeq.length - 1] !== v) window.__upSeq.push(v);
  }).observe(card, { attributes: true, attributeFilter: ["data-upgrading"] });
};

async function checkCardUpgrade(browser) {
  const lastText = async (page) => ((await page.locator("#cardkit-last").textContent()) ?? "").trim();
  const ends = async (page) => Number(await page.locator("#cardkit-last").getAttribute("data-ends"));
  const waitLast = async (page, want, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await lastText(page)).includes(want)) return Date.now() - t0;
      await page.waitForTimeout(30);
    }
    return -1;
  };
  const play = (page, label) => page.getByRole("button", { name: label, exact: true }).click();

  // ① 完整动效：1→5 逐档快进、4→5、跳过；dev 构建跑在 StrictMode 下，每次结束回调必须正好 1 次
  {
    const fails = [];
    const notes = [];
    const { context, page } = await openPage(browser, { width: 1440, height: 900, theme: "light", motion: true });
    await page.addInitScript(TIMER_SPY);
    await visit(page, "/__kit/cards");
    const stage = page.locator(".cardkit__stage .acard");
    await page.evaluate(WATCH_STAGE);

    await play(page, "连升 1→5");
    const chain = await waitLast(page, "1→5 播完", 3000 + 1500);
    const seq = await page.evaluate(() => window.__upSeq.join(","));
    if (chain < 0) fails.push(`连升 1→5 4.5 秒内没播完（${await lastText(page)}）`);
    else if (chain > 3000 + 600) fails.push(`连升 1→5 用了 ${chain}ms，超过 3 秒`);
    else notes.push(`1→5 ${chain}ms`);
    if (seq !== "2,3,4,5") fails.push(`逐档顺序是 ${seq || "空"}，应为 2,3,4,5`);
    if ((await stage.getAttribute("data-level")) !== "5") fails.push(`连升停在 Lv.${await stage.getAttribute("data-level")}`);
    await page.waitForTimeout(300);
    if ((await ends(page)) !== 1) fails.push(`StrictMode 下连升结束回调 ${await ends(page)} 次，应为 1`);

    await play(page, "4→5");
    if (!(await stage.getAttribute("data-upgrading"))) fails.push("4→5 点了没开始播");
    if (!((await stage.locator(".acard__notice").textContent().catch(() => "")) ?? "").includes("升到 Lv.5")) fails.push("4→5 没有「升到 Lv.5」提示");
    const single = await waitLast(page, "4→5 播完", 1800 + 1500);
    if (single < 0) fails.push("4→5 没播完");
    else notes.push(`4→5 ${single}ms`);
    await page.waitForTimeout(300);
    if ((await ends(page)) !== 2) fails.push(`4→5 后回调累计 ${await ends(page)} 次，应为 2`);

    await play(page, "2→3");
    await page.getByRole("button", { name: "跳过" }).click();
    if ((await waitLast(page, "2→3 已跳过", 500)) < 0) fails.push("跳过没有立即落到新卡面");
    await page.waitForTimeout(1200);
    if ((await ends(page)) !== 3) fails.push(`跳过后回调累计 ${await ends(page)} 次，应为 3`);
    else notes.push("跳过即停，回调各 1 次");
    await context.close();
    record("好感度卡升级：1→5 逐档快进 / 4→5 / 跳过 / StrictMode 回调次数", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
  }

  // ② 跳过和定时器同一拍：先点跳过，再执行那个已经到点的回调，卡不能复活、回调不能多一次
  {
    const fails = [];
    const { context, page } = await openPage(browser, { width: 1440, height: 900, theme: "light", motion: true });
    await page.addInitScript(TIMER_SPY);
    await visit(page, "/__kit/cards");
    const stage = page.locator(".cardkit__stage .acard");
    await play(page, "连升 1→5");
    await page.waitForTimeout(150);
    const raced = await page.evaluate(() => {
      const pending = window.__cardTimers.filter((t) => !t.cleared && !t.fired);
      const due = pending[pending.length - 1];
      document.querySelector(".cardkit__stage .acard__skip").click();
      if (!due) return false;
      due.fn();
      return true;
    });
    if (!raced) fails.push("没找到在跑的升级定时器");
    await page.waitForTimeout(300);
    if (await stage.getAttribute("data-upgrading")) fails.push(`跳过后又被定时器拉回 Lv.${await stage.getAttribute("data-upgrading")} 的动画`);
    if ((await stage.getAttribute("data-level")) !== "5") fails.push(`跳过后停在 Lv.${await stage.getAttribute("data-level")}`);
    await page.waitForTimeout(3200);
    if (await stage.getAttribute("data-upgrading")) fails.push("3 秒后仍在播");
    const n = await ends(page);
    if (n !== 1) fails.push(`结束回调 ${n} 次，应为 1（${await lastText(page)}）`);
    if (!(await lastText(page)).includes("1→5 已跳过")) fails.push(`最后一次是「${await lastText(page)}」，应为 1→5 已跳过`);
    await context.close();
    record("好感度卡升级：跳过与定时器同一拍不复活", fails.length === 0, fails.length ? fails.join("；") : "跳过后执行到点回调：不复活，回调 1 次");
  }

  // ③ 安静模式开关（不靠系统 reduced-motion）和系统减少动态
  {
    const fails = [];
    const notes = [];
    const { context, page } = await openPage(browser, { width: 1440, height: 900, theme: "light", motion: true });
    await visit(page, "/__kit/cards");
    const stage = page.locator(".cardkit__stage .acard");
    const calmSwitch = page.getByRole("switch", { name: "安静模式" });
    await calmSwitch.click();
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-motion"))) !== "calm") fails.push("开关打开后根节点没有 data-motion=calm");
    await play(page, "连升 1→5");
    if ((await stage.getAttribute("data-calm")) !== "true") fails.push("安静模式下升级没有走 calm 分支");
    if (!((await stage.locator(".acard__notice").textContent().catch(() => "")) ?? "").includes("升到 Lv.")) fails.push("安静模式没有「升到 Lv.N」提示");
    const calmSpent = await waitLast(page, "1→5 播完", 4 * 450 + 1500);
    if (calmSpent < 0) fails.push("安静模式 1→5 没播完");
    else notes.push(`安静 1→5 ${calmSpent}ms`);
    await calmSwitch.click();
    await play(page, "4→5");
    if ((await stage.getAttribute("data-calm")) === "true") fails.push("关掉安静模式后仍走 calm 分支");
    if ((await waitLast(page, "4→5 播完", 1800 + 1500)) < 0) fails.push("关掉安静模式后 4→5 没播完");
    else notes.push("关掉后恢复完整动效");
    await context.close();

    const reduced = await openPage(browser, { width: 1440, height: 900, theme: "light", motion: false });
    await visit(reduced.page, "/__kit/cards");
    await play(reduced.page, "连升 1→5");
    if ((await reduced.page.locator(".cardkit__stage .acard").getAttribute("data-calm")) !== "true") fails.push("系统减少动态下没有走 calm 分支");
    const rSpent = await waitLast(reduced.page, "1→5 播完", 4 * 450 + 1500);
    if (rSpent < 0) fails.push("减少动态 1→5 没播完");
    else notes.push(`减少动态 1→5 ${rSpent}ms`);
    await reduced.context.close();
    record("好感度卡升级：安静模式开关 / 系统减少动态", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
  }

  // ④ 缩略卡是静态的：给了 upgradeFrom 也不播、不出提示和跳过、不调回调
  {
    const fails = [];
    const { context, page } = await openPage(browser, { width: 1440, height: 900, theme: "light", motion: true });
    await visit(page, "/__kit/cards");
    const thumbs = page.getByTestId("card-thumbs");
    await page.getByRole("button", { name: "缩略卡试播升级", exact: true }).click();
    await page.waitForTimeout(100);
    if ((await thumbs.locator(".acard[data-upgrading]").count()) > 0) fails.push("缩略卡开始播升级");
    if ((await thumbs.locator(".acard__skip, .acard__notice").count()) > 0) fails.push("缩略卡渲染了跳过 / 提示");
    await page.waitForTimeout(2200);
    const n = Number(await thumbs.getAttribute("data-ends"));
    if (n !== 0) fails.push(`缩略卡调了 ${n} 次 onUpgradeEnd`);
    await context.close();
    record("好感度卡：缩略卡不播升级", fails.length === 0, fails.length ? fails.join("；") : "无动画、无跳过、无回调");
  }

  // ⑥ 播放中打断：清空 upgradeFrom 或卸载卡片，这一轮作废，到点也不回调
  {
    const fails = [];
    const notes = [];
    const { context, page } = await openPage(browser, { width: 1440, height: 900, theme: "light", motion: true });
    await visit(page, "/__kit/cards");
    const stage = page.locator(".cardkit__stage .acard");
    for (const [label, action] of [["清空 upgradeFrom", "清空 upgradeFrom"], ["卸载", "卸载卡片"]]) {
      const before = await ends(page);
      await play(page, "连升 1→5");
      await page.waitForTimeout(250);
      if (!(await stage.getAttribute("data-upgrading"))) fails.push(`${label}前 1→5 没开始播`);
      await page.getByRole("button", { name: action, exact: true }).click();
      await page.waitForTimeout(50);
      if (label !== "卸载" && (await stage.getAttribute("data-upgrading"))) fails.push(`${label}后还在播 Lv.${await stage.getAttribute("data-upgrading")}`);
      await page.waitForTimeout(3000 + 600);
      const n = (await ends(page)) - before;
      if (n !== 0) fails.push(`${label}后旧一轮又回调了 ${n} 次（${await lastText(page)}）`);
      else notes.push(`${label}：停播、0 次回调`);
      if (label === "卸载") await page.getByRole("button", { name: "挂回卡片", exact: true }).click();
    }
    await context.close();
    record("好感度卡升级：播放中清空 upgradeFrom / 卸载不回调", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
  }

  // ⑦ 读屏只念卡根的 aria-label：名字牌和档位点对读屏隐藏（主卡、缩略卡都查）
  {
    const fails = [];
    const { context, page } = await openPage(browser, { width: 1440, height: 900, theme: "light", motion: true });
    await visit(page, "/__kit/cards");
    const cards = [["主卡", page.getByTestId("card-tiers").locator(".acard").nth(2)], ["缩略卡", page.getByTestId("card-thumbs").locator(".acard").nth(2)]];
    let snap = "";
    for (const [label, card] of cards) {
      snap = await card.ariaSnapshot();
      const lines = snap.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!/^- group "鲸汐的好感度卡，Lv\.3 默契，潮光卡面"/.test(lines[0] ?? "")) fails.push(`${label}根节点是 ${lines[0]}`);
      const extra = lines.slice(1).filter((l) => l !== "- status");
      if (extra.length) fails.push(`${label}卡内还会念：${extra.join(" / ")}`);
    }
    await context.close();
    record("好感度卡：名字牌不重复念（ariaSnapshot）", fails.length === 0, fails.length ? fails.join("；") : `主卡、缩略卡都只念卡根：${snap.split("\n")[0].trim()}`);
  }

  // ⑤ 触屏横向拖动能倾斜，松手复位（390 宽，真实触摸序列）
  {
    const fails = [];
    const { context, page } = await openPage(browser, { width: 390, height: 844, theme: "light", motion: true, touch: true });
    await visit(page, "/__kit/cards");
    const card = page.getByTestId("card-tiers").locator(".acard").nth(2);
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    const cdp = await context.newCDPSession(page);
    const at = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(cx, cy) });
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(cx + i * 10, cy + i * 2) });
      await page.waitForTimeout(16);
    }
    const mid = await card.evaluate((el) => ({ px: el.style.getPropertyValue("--px"), on: el.dataset.pointer ?? "" }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(100);
    const after = await card.evaluate((el) => el.style.getPropertyValue("--px") || "0");
    const touchAction = await card.evaluate((el) => getComputedStyle(el).touchAction);
    if (!(Number(mid.px) > 0.1)) fails.push(`拖动中 --px=${mid.px || "0"}，没有倾斜（touch-action: ${touchAction}）`);
    if (Number(after) !== 0) fails.push(`松手后 --px=${after}，没有复位`);
    await context.close();
    record("好感度卡：触屏拖动倾斜 / 松手复位", fails.length === 0, fails.length ? fails.join("；") : `拖动中 --px=${mid.px}，松手归 0，touch-action: ${touchAction}`);
  }
}


/** 17. 设置页两处交互：存了 Codex 模型后顶部概览跟着变；点目录后亮的就是刚点的那个（手机 380 × 字号 2 倍，吸顶目录会挡住标题）。 */
async function checkSettingsInteractions(browser) {
  const fails = [];
  const notes = [];

  // 1) 概览与模型设置共用一份结果：存成功后概览不用重进页面
  {
    const { context, page } = await openPage(browser, { width: 1440, height: 900 });
    const saved = { model: "model-a", effort: "medium" };
    const entry = (model) => ({ model, displayName: model, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "medium", description: "" }], isDefault: model === "model-a" });
    await page.route(/\/api\/setup(\/|\?|$)/, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (path.endsWith("/codex/models")) return json({ models: [entry("model-a"), entry("model-b")] });
      if (path.endsWith("/setup/codex") && request.method() === "PUT") {
        Object.assign(saved, JSON.parse(request.postData() ?? "{}"));
        return json({});
      }
      return json({ deepseek: { configured: false, masked: null }, codex: { ...saved, configPath: "/tmp/codex.toml", present: true }, chain: ["codex"] });
    });
    await visit(page, "/settings");
    const chip = () => page.locator(".set-chip", { hasText: "当前模型" }).locator(".set-chip__value").innerText();
    const before = await chip();
    await page.selectOption("#mset-model", "model-b");
    await page.locator(".mset__save").last().click();
    let after = before;
    for (let i = 0; i < 20 && !after.includes("model-b"); i += 1) {
      await page.waitForTimeout(150);
      after = await chip();
    }
    if (!before.includes("model-a")) fails.push(`保存前概览应显示 model-a，实际「${before}」`);
    if (!after.includes("model-b")) fails.push(`保存 model-b 后概览仍是「${after}」`);
    notes.push(`概览 ${before.replace(/\s+/g, " ")}→${after.replace(/\s+/g, " ")}`);
    await context.close();
  }

  // 2) 点目录 → 滚动稳定后，目录亮的就是刚点的那项
  for (const [label, width, height, scale] of [["桌面", 1440, 900, 1], ["手机 380×560 ×2", 380, 560, 2]]) {
    const { context, page } = await openPage(browser, { width, height });
    await page.addInitScript((value) => localStorage.setItem("wp.scale", String(value)), scale);
    await visit(page, "/settings");
    const items = page.locator(".set-nav__item");
    const count = await items.count();
    const wrong = [];
    for (let i = 0; i < count; i += 1) {
      const name = (await items.nth(i).innerText()).trim();
      await items.nth(i).click();
      let last = -1;
      for (let tries = 0; tries < 20; tries += 1) {
        await page.waitForTimeout(150);
        const top = await page.evaluate(() => document.querySelector(".page--settings").scrollTop);
        if (top === last) break;
        last = top;
      }
      await page.waitForTimeout(200);
      const lit = (await page.locator('.set-nav__item[aria-current="true"]').allInnerTexts()).map((t) => t.trim()).join("/");
      if (lit !== name) wrong.push(`点「${name}」亮「${lit || "无"}」`);
    }
    if (wrong.length) fails.push(`${label}：${wrong.join("、")}`);
    notes.push(`${label} ${count - wrong.length}/${count}`);
    await context.close();
  }
  return record("设置页：存模型后概览同步；点目录后亮的是刚点的", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
}


/** 25. 好感度卡接真实等级（#160）：假接口把 Lv3 改成 Lv4 并刷新，卡面播一次 3→4；再开、刷新页面都不重播；换角色互不影响。 */
async function checkCardLive(browser) {
  const fails = [];
  const notes = [];
  const levels = { ...DEFAULT_LEVELS, whale: 3, deepseek: 2, claude: 1, chatgpt: 5 };
  const errors = [];
  const { context, page } = await openPage(browser, { width: 1440, height: 900, motion: true, levels, character: "whale" });
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  // 记下主卡每次「开始升级」（data-upgrading 从无到有）和升到的档位，刷新页面后重新计数
  await page.addInitScript(() => {
    window.__ups = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target;
        if (el.matches?.('.set-card .acard[data-size="md"]') && el.hasAttribute("data-upgrading") && r.oldValue === null) {
          window.__ups.push({ to: el.getAttribute("data-upgrading"), ghost: el.querySelector(".acard__skin--ghost")?.getAttribute("data-level") ?? null });
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-upgrading"], attributeOldValue: true });
  });

  const seen = (id) => page.evaluate((k) => localStorage.getItem(`wp.cardSeenLevel.${k}`), id);
  const ups = () => page.evaluate(() => window.__ups);
  const card = '.set-card .acard[data-size="md"]';
  const openDialog = async () => {
    await page.locator(".set-her__swap").click();
    await page.locator(card).waitFor({ timeout: 8000 });
  };
  const closeDialog = async () => {
    await page.keyboard.press("Escape");
    await page.locator(".set-dialog--chars").waitFor({ state: "detached", timeout: 4000 });
  };
  const idle = async () => {
    for (let i = 0; i < 40; i += 1) {
      if (!(await page.locator(`${card}[data-upgrading]`).count())) return true;
      await page.waitForTimeout(150);
    }
    return false;
  };
  const shownLevel = () => page.locator(card).getAttribute("data-level");

  await visit(page, "/settings");

  // 1) 首次（没有记录）：显示当前等级，不播，直接记成 3；缩略卡各显示自己的等级
  await openDialog();
  await page.waitForTimeout(700);
  if ((await shownLevel()) !== "3") fails.push(`首次打开应显示 Lv3，实际 ${await shownLevel()}`);
  if ((await ups()).length) fails.push(`首次安装不该播，却播了 ${JSON.stringify(await ups())}`);
  if ((await seen("whale")) !== "3") fails.push(`首次应记下 whale=3，实际 ${await seen("whale")}`);
  const thumbs = await page.locator('.set-char__thumb .acard[data-size="sm"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-character")}:${e.getAttribute("data-level")}`));
  const want = ["deepseek:2", "claude:1", "chatgpt:5", "whale:3"]; // 列表顺序就是 CHARACTERS 的顺序
  if (thumbs.join() !== want.join()) fails.push(`缩略卡等级 ${thumbs.join(" ")}，应为 ${want.join(" ")}`);
  if (await page.locator('.set-char__thumb .acard__skip, .set-char__thumb [data-upgrading]').count()) fails.push("缩略卡出现了跳过按钮或升级状态");
  notes.push(`首次 Lv3 不播、记 3；缩略卡 ${thumbs.join(" ")}`);

  // 2) 后端升到 Lv4，关掉再打开（打开时刷新）：正好播一次 3→4，播完记成 4
  await closeDialog();
  levels.whale = 4;
  await openDialog();
  await page.locator(`${card}[data-upgrading="4"]`).waitFor({ timeout: 4000 }).catch(() => { fails.push("升到 Lv4 后卡面没有开始 3→4 的升级动画"); });
  const during = await page.locator(card).evaluate((el) => ({ ghost: el.querySelector(".acard__skin--ghost")?.getAttribute("data-level") ?? null })).catch(() => ({ ghost: null }));
  if (during.ghost !== "3") fails.push(`升级动画的旧卡面应是 Lv3，实际 ${during.ghost}`);
  if (!(await idle())) fails.push("升级动画 6 秒没播完");
  await page.waitForTimeout(300);
  let log = await ups();
  if (log.length !== 1 || log[0].to !== "4") fails.push(`3→4 应正好播一次，实际 ${JSON.stringify(log)}`);
  if ((await shownLevel()) !== "4") fails.push(`播完应落在 Lv4，实际 ${await shownLevel()}`);
  if ((await seen("whale")) !== "4") fails.push(`播完应记下 whale=4，实际 ${await seen("whale")}`);
  notes.push("3→4 播 1 次，记 4");

  // 3) 同一次升档不重播：再关再开；刷新页面后再开
  await closeDialog();
  await openDialog();
  await page.waitForTimeout(900);
  log = await ups();
  if (log.length !== 1) fails.push(`关掉再开不该重播，累计 ${log.length} 次`);
  await closeDialog();
  await page.reload({ waitUntil: "networkidle" });
  await openDialog();
  await page.waitForTimeout(900);
  log = await ups();
  if (log.length !== 0) fails.push(`刷新页面后不该重播，却播了 ${JSON.stringify(log)}`);
  if ((await shownLevel()) !== "4") fails.push(`刷新后应显示 Lv4，实际 ${await shownLevel()}`);
  notes.push("再开 / 刷新页面都不重播");

  // 4) 换角色互不影响：大肥鱼第一次看（Lv2）不播，不动鲸汐的记录；它升到 Lv3 只播它自己，鲸汐的记录还是 4
  await page.locator(".set-char", { hasText: "大肥鱼" }).click();
  await page.waitForTimeout(900);
  if ((await page.locator(card).getAttribute("data-character")) !== "deepseek") fails.push("点大肥鱼后主卡没有换成大肥鱼");
  if ((await ups()).length) fails.push(`换到大肥鱼首次看到不该播，却播了 ${JSON.stringify(await ups())}`);
  if ((await seen("deepseek")) !== "2") fails.push(`大肥鱼首次应记 2，实际 ${await seen("deepseek")}`);
  if ((await seen("whale")) !== "4") fails.push(`鲸汐的记录被动了：${await seen("whale")}`);
  await closeDialog();
  levels.deepseek = 3;
  await openDialog();
  await page.locator(`${card}[data-upgrading="3"]`).waitFor({ timeout: 4000 }).catch(() => { fails.push("大肥鱼升到 Lv3 后没有播 2→3"); });
  await idle();
  await page.waitForTimeout(300);
  log = await ups();
  if (log.length !== 1 || log[0].to !== "3" || log[0].ghost !== "2") fails.push(`大肥鱼 2→3 应正好播一次，实际 ${JSON.stringify(log)}`);
  if ((await seen("deepseek")) !== "3") fails.push(`大肥鱼播完应记 3，实际 ${await seen("deepseek")}`);
  if ((await seen("whale")) !== "4") fails.push(`大肥鱼升档动了鲸汐的记录：${await seen("whale")}`);
  await page.locator(".set-char", { hasText: "鲸汐" }).click();
  await page.waitForTimeout(900);
  log = await ups();
  if (log.length !== 1) fails.push(`换回鲸汐不该再播，累计 ${log.length} 次`);
  if ((await shownLevel()) !== "4") fails.push(`换回鲸汐应显示 Lv4，实际 ${await shownLevel()}`);
  notes.push("换角色各记各的：大肥鱼 2→3 只播它自己，鲸汐仍是 4");

  // 5) 清掉存储：当作首次，不播、记当前；读取失败：有重试，重试读到后不播
  await closeDialog();
  await page.evaluate(() => localStorage.removeItem("wp.cardSeenLevel.whale"));
  await openDialog();
  await page.waitForTimeout(700);
  if ((await ups()).length !== 1) fails.push("清掉记录后打开不该播");
  if ((await seen("whale")) !== "4") fails.push(`清掉记录后应重新记当前 4，实际 ${await seen("whale")}`);
  await closeDialog();
  await context.close();

  const broken = await openPage(browser, { width: 1440, height: 900, motion: true, levels: { ...levels }, character: "whale" });
  const bp = broken.page;
  let down = true;
  await bp.route(/\/api\/relationship/, async (route) => {
    if (down) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.fallback();
  });
  bp.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  await visit(bp, "/settings");
  await bp.locator(".set-her__swap").click();
  const retry = bp.getByRole("button", { name: "重试读取好感度" });
  await retry.waitFor({ timeout: 6000 }).catch(() => fails.push("好感度读取失败时没有重试入口"));
  if (await bp.locator('.set-card .acard[data-size="md"]').count()) fails.push("读取失败时不该画出带等级的卡");
  down = false;
  await retry.click().catch(() => {});
  await bp.locator('.set-card .acard[data-size="md"]').waitFor({ timeout: 6000 }).catch(() => fails.push("点重试后卡面没有出来"));
  await bp.waitForTimeout(600);
  if (await bp.locator('.set-card .acard[data-upgrading]').count()) fails.push("重试读到后不该播（首次）");
  notes.push("清存储 / 读取失败 → 重试都不播、不报错");
  await broken.context.close();

  if (errors.length) fails.push(`页面报错：${errors.slice(0, 3).join(" | ")}`);
  return record("好感度卡接真实等级：Lv3→4 播一次 / 刷新不重播 / 换角色互不影响", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
}

/** 28. 切档看低档卡面：只在已解锁档位内切；只改卡面显示，真实等级、进度、「上次看到的等级」不动；不发写请求；刷新后保留；真升档时回到最高档播动画。 */
async function checkCardView(browser) {
  const fails = [];
  const notes = [];
  const errors = [];
  const levels = { ...DEFAULT_LEVELS, deepseek: 4 };
  const { context, page } = await openPage(browser, { width: 1440, height: 900, motion: true, levels, character: "deepseek" });
  await page.addInitScript(() => { if (!sessionStorage.__cv) { sessionStorage.__cv = "1"; localStorage.setItem("wp.cardSeenLevel.deepseek", "4"); } });
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  const writes = [];
  page.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET") writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  const card = '.set-card .acard[data-size="md"]';
  const store = (k) => page.evaluate((key) => localStorage.getItem(key), k);
  const shown = () => page.locator(card).getAttribute("data-level");
  const btn = (n) => page.locator(".card-view__btn", { hasText: `Lv.${n}` });
  const open = async () => {
    await page.locator(".set-her__swap").click();
    await page.locator(card).waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await page.locator(".set-dialog--chars").waitFor({ state: "detached", timeout: 4000 });
  };

  await visit(page, "/settings");
  await open();
  if ((await shown()) !== "4") fails.push(`默认应显示真实等级 Lv4，实际 ${await shown()}`);
  const states = await page.locator(".card-view__btn").evaluateAll((els) => els.map((e) => `${e.textContent}:${e.disabled ? "锁" : "开"}`));
  if (states.join() !== "Lv.1:开,Lv.2:开,Lv.3:开,Lv.4:开,Lv.5:锁") fails.push(`切档按钮状态 ${states.join(" ")}，应为 Lv1–4 可点、Lv5 锁住`);
  // 没解锁的 Lv5：按钮是 disabled，点不动；直接派发 click 也不换档
  await btn(5).evaluate((el) => el.click());
  await page.waitForTimeout(200);
  if ((await shown()) !== "4" || (await store("wp.cardViewLevel.deepseek")) !== null) fails.push("点了没解锁的 Lv5 却换了档或写了记录");

  // Live2D 舞台在切档前后是同一个节点（不重建）
  const hasStage = await page.locator(`${card} .acard__art .live2d`).count();
  if (!hasStage) fails.push("大肥鱼 Lv4 的卡面立绘槽里没有 Live2D 舞台");
  await page.locator(`${card} .acard__art .live2d`).evaluate((el) => { el.__mark = 1; }).catch(() => {});

  await btn(2).click();
  await page.waitForTimeout(300);
  if ((await shown()) !== "2") fails.push(`点 Lv.2 后卡面应是 Lv2，实际 ${await shown()}`);
  if ((await btn(2).getAttribute("aria-pressed")) !== "true") fails.push("Lv.2 按钮没有标成选中");
  if (await page.locator(`${card}[data-upgrading]`).count()) fails.push("切到低档不该播升级动画");
  const title = await page.locator(".set-card__title").innerText();
  const head = await page.locator(".set-card__progress-head").innerText();
  if (!title.includes("Lv.4") || !head.includes("Lv.4")) fails.push(`切档后卡外的真实等级变了：「${title.replace(/\s+/g, " ")}」「${head.replace(/\s+/g, " ")}」`);
  if ((await store("wp.cardSeenLevel.deepseek")) !== "4") fails.push(`切档动了「上次看到的等级」：${await store("wp.cardSeenLevel.deepseek")}`);
  if ((await store("wp.cardViewLevel.deepseek")) !== "2") fails.push(`显示档位应存 2，实际 ${await store("wp.cardViewLevel.deepseek")}`);
  const same = await page.locator(`${card} .acard__art .live2d`).evaluate((el) => el.__mark === 1).catch(() => false);
  if (hasStage && !same) fails.push("切档后 Live2D 舞台被重建了");
  notes.push("Lv5 锁住；切到 Lv2：卡面 2，卡外仍 Lv4，seen 仍 4，Live2D 未重建");

  // 重启（刷新页面）后仍是 Lv2，不播
  await close();
  await page.reload({ waitUntil: "networkidle" });
  await open();
  if ((await shown()) !== "2") fails.push(`刷新后应保留 Lv2，实际 ${await shown()}`);
  if (await page.locator(`${card}[data-upgrading]`).count()) fails.push("刷新后不该播");
  // 选回 Lv4：删掉记录，跟着真实等级
  await btn(4).click();
  await page.waitForTimeout(200);
  if ((await shown()) !== "4" || (await store("wp.cardViewLevel.deepseek")) !== null) fails.push(`选回 Lv4 应删掉记录，实际卡面 ${await shown()}、记录 ${await store("wp.cardViewLevel.deepseek")}`);
  await btn(3).click();
  notes.push("刷新后保留 Lv2；选回最高档删记录");

  // 真升档（4→5）：回到最高档播 4→5，删掉显示档位记录，seen 记 5
  await close();
  levels.deepseek = 5;
  await open();
  await page.locator(`${card}[data-upgrading="5"]`).waitFor({ timeout: 4000 }).catch(() => fails.push("固定看 Lv3 时升到 Lv5，没有播 4→5"));
  for (let i = 0; i < 40 && (await page.locator(`${card}[data-upgrading]`).count()); i += 1) await page.waitForTimeout(150);
  await page.waitForTimeout(300);
  if ((await shown()) !== "5") fails.push(`升档播完应显示 Lv5，实际 ${await shown()}`);
  if ((await store("wp.cardViewLevel.deepseek")) !== null) fails.push("升档后显示档位记录没删");
  if ((await store("wp.cardSeenLevel.deepseek")) !== "5") fails.push(`升档后 seen 应是 5，实际 ${await store("wp.cardSeenLevel.deepseek")}`);
  notes.push("看 Lv3 时升到 Lv5：播 4→5 后显示 Lv5");

  if (writes.length) fails.push(`切档发了写请求：${writes.join(", ")}`);
  if (errors.length) fails.push(`页面报错：${errors.slice(0, 3).join(" | ")}`);
  await context.close();
  return record("好感度卡切档：只在已解锁内切、不动真实等级、刷新后保留、升档回最高档", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
}

/** 26b. 「换一位」里主卡和缩略卡共用一份等级（#160 返工）：接口全挂后点重试四张缩略卡一起恢复；只有一个非当前角色失败时也有重试入口、重试只重读它；弹窗开着时后端升档，切角色后主卡和缩略卡一致；打开弹窗每个角色只请求一次，开着换角色只读新的当前角色。 */
async function checkCardShared(browser) {
  const fails = [];
  const notes = [];
  const errors = [];
  const thumbSel = ".set-char__thumb .acard";
  const card = '.set-card .acard[data-size="md"]';

  // 1) 全部 500 → 打开弹窗 → 点重试 → 4 张缩略卡 + 4 个等级字样都在
  {
    const levels = { ...DEFAULT_LEVELS };
    const { context, page } = await openPage(browser, { width: 1440, height: 900, motion: true, levels, character: "whale" });
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    let down = true;
    await page.route(/\/api\/relationship/, (route) => (down ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.fallback()));
    await visit(page, "/settings");
    await page.locator(".set-her__swap").click();
    const retry = page.getByRole("button", { name: "重试读取好感度" });
    await retry.waitFor({ timeout: 6000 }).catch(() => fails.push("全部 500 时没有重试入口"));
    await page.waitForTimeout(500);
    if (await page.locator(thumbSel).count()) fails.push("全部 500 时缩略卡不该有卡面");
    down = false;
    await retry.click().catch(() => {});
    await page.locator(card).waitFor({ timeout: 6000 }).catch(() => fails.push("点重试后主卡没有出来"));
    await page.waitForFunction(() => document.querySelectorAll(".set-char__thumb .acard").length === 4 && document.querySelectorAll(".set-char__level").length === 4, null, { timeout: 6000 }).catch(() => {});
    const thumbs = await page.locator(thumbSel).count();
    const labels = await page.locator(".set-char__level").count();
    if (thumbs !== 4 || labels !== 4) fails.push(`点重试后缩略卡 ${thumbs}/4、等级字样 ${labels}/4（必须关掉弹窗再开才恢复就是这个现象）`);
    else notes.push("全部 500 → 重试：缩略卡 4/4、等级字样 4/4");
    await context.close();
  }

  // 2) 弹窗开着时后端把大肥鱼 Lv2→Lv3，点大肥鱼：主卡和缩略卡等级一致；并数打开弹窗的请求
  {
    const levels = { ...DEFAULT_LEVELS };
    const { context, page } = await openPage(browser, { width: 1440, height: 900, motion: true, levels, character: "whale" });
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    let requests = 0;
    page.on("request", (r) => { if (r.url().includes("/api/relationship")) requests += 1; });
    await visit(page, "/settings");
    requests = 0;
    await page.locator(".set-her__swap").click();
    await page.locator(card).waitFor({ timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll(".set-char__thumb .acard").length === 4, null, { timeout: 6000 }).catch(() => fails.push("打开弹窗后缩略卡没有出齐"));
    await page.waitForTimeout(800);
    if (requests > 4) fails.push(`打开弹窗发了 ${requests} 次 /api/relationship，最多一个角色一次（4）`);
    notes.push(`打开弹窗请求 ${requests} 次`);
    levels.deepseek = 3;
    await page.locator(".set-char", { hasText: "大肥鱼" }).click();
    await page.locator(`${card}[data-character="deepseek"]`).waitFor({ timeout: 4000 }).catch(() => fails.push("点大肥鱼后主卡没有换"));
    for (let i = 0; i < 40; i += 1) {
      if (!(await page.locator(`${card}[data-upgrading]`).count()) && (await page.locator(card).getAttribute("data-level")) === "3") break;
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(400);
    const main = await page.locator(card).getAttribute("data-level");
    const thumb = await page.locator(".set-char", { hasText: "大肥鱼" }).locator(".acard").getAttribute("data-level");
    const label = await page.locator(".set-char", { hasText: "大肥鱼" }).locator(".set-char__level").textContent();
    if (main !== "3" || thumb !== main || !label?.includes("Lv.3")) fails.push(`点大肥鱼后主卡 Lv${main}、缩略卡 Lv${thumb}、字样「${label}」，应当都是 Lv3`);
    else notes.push("弹窗里 Lv2→3 后切角色：主卡 / 缩略卡 / 字样都是 Lv3");
    await context.close();
  }

  // 3) 只有一个非当前角色（小克）的请求失败：主卡正常，仍有重试入口；点重试后它的缩略卡和等级字样回来，且只重读它一个
  {
    const levels = { ...DEFAULT_LEVELS };
    const { context, page } = await openPage(browser, { width: 1440, height: 900, motion: true, levels, character: "whale" });
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    let down = true;
    await page.route(/\/api\/relationship\?character=claude/, (route) => (down ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.fallback()));
    const asked = [];
    page.on("request", (r) => { const m = r.url().match(/\/api\/relationship\?character=(\w+)/); if (m) asked.push(m[1]); });
    await visit(page, "/settings");
    await page.locator(".set-her__swap").click();
    await page.locator(card).waitFor({ timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll(".set-char__thumb .acard").length === 3, null, { timeout: 6000 }).catch(() => {});
    const claude = page.locator(".set-char", { hasText: "小克" });
    const retry = page.getByRole("button", { name: "重试读取好感度" });
    if ((await page.locator(thumbSel).count()) !== 3 || (await claude.locator(".acard").count())) fails.push("小克 500 时应只缺小克一张缩略卡");
    if (!(await retry.isVisible().catch(() => false))) fails.push("只有小克的缩略卡读取失败时没有重试入口（要关掉弹窗再开才恢复就是这个现象）");
    down = false;
    asked.length = 0;
    await retry.click({ timeout: 2000 }).catch(() => {});
    await claude.locator(".acard").waitFor({ timeout: 4000 }).catch(() => fails.push("点重试后小克的缩略卡没有回来"));
    await page.waitForTimeout(500);
    if (!(await claude.locator(".set-char__level").count())) fails.push("点重试后小克的等级字样没有回来");
    if (asked.join() !== "claude") fails.push(`重试只该重读失败的小克，实际请求：${asked.join(",") || "无"}`);
    if (await retry.count()) fails.push("全部恢复后重试入口还在");
    else if (!fails.length) notes.push("单个缩略卡 500：有重试入口，点后只重读它（1 次），缩略卡 + 字样回来");
    await context.close();
  }

  // 4) 弹窗开着连续换角色：每次只读新的当前角色，不重读全部四个；只有打开弹窗读全部
  {
    const levels = { ...DEFAULT_LEVELS };
    const { context, page } = await openPage(browser, { width: 1440, height: 900, motion: true, levels, character: "whale" });
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    const asked = [];
    page.on("request", (r) => { const m = r.url().match(/\/api\/relationship\?character=(\w+)/); if (m) asked.push(m[1]); });
    await visit(page, "/settings");
    await page.locator(".set-her__swap").click();
    await page.locator(card).waitFor({ timeout: 8000 });
    await page.waitForFunction(() => document.querySelectorAll(".set-char__thumb .acard").length === 4, null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(600);
    asked.length = 0;
    for (const [name, id] of [["大肥鱼", "deepseek"], ["小克", "claude"], ["小智", "chatgpt"]]) {
      await page.locator(".set-char", { hasText: name }).click();
      await page.locator(`${card}[data-character="${id}"]`).waitFor({ timeout: 4000 }).catch(() => fails.push(`点${name}后主卡没有换`));
      await page.waitForTimeout(500);
    }
    if (asked.join() !== "deepseek,claude,chatgpt") fails.push(`弹窗开着连续换 3 次角色，应只请求 deepseek,claude,chatgpt，实际 ${asked.length} 次：${asked.join(",")}`);
    else notes.push("弹窗开着连续换 3 个角色：各 1 次请求（只读新的当前角色）");
    await context.close();
  }

  if (errors.length) fails.push(`页面报错：${errors.slice(0, 3).join(" | ")}`);
  return record("「换一位」主卡与缩略卡共用等级：重试一起恢复 / 单卡失败可重试 / 切角色一致 / 请求不多发", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
}

/** 26c. 聊天页升档提示（#160 返工）：一轮聊天结束好感度跨档，出现一次吐司；同一档不再提示、刷新后不再出现；提示不改「上次看到的等级」；点「去看看」到设置页打开卡面。 */
async function checkChatLevelUp(browser) {
  const fails = [];
  const notes = [];
  const errors = [];
  const toasts = (page) => page.locator(".ui-toast");
  const open = async () => {
    const levels = { ...DEFAULT_LEVELS, whale: 3 };
    const { context, page } = await openPage(browser, { width: 1440, height: 900, motion: true, levels, character: "whale" });
    page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
    let turn = 0;
    await page.route(/\/api\/chat$/, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      turn += 1;
      const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: ev("ack", { sessionId: "s1" }) + ev("emotion", { emotion: "happy" }) + ev("delta", { text: `第${turn}轮：你好呀。` }) + ev("done", { messageId: turn, sessionId: "s1", emotion: "happy" }),
      });
    });
    await visit(page, "/");
    // 设置页「上次看到的等级」是 Lv3（看过 Lv3 的卡面）
    await page.evaluate(() => localStorage.setItem("wp.cardSeenLevel.whale", "3"));
    const say = async () => {
      const next = turn + 1; // 先取下一轮的编号，再发送（路由会立刻把 turn 加一）
      const box = page.locator("textarea").first();
      await box.fill("在吗");
      await box.press("Enter");
      await page.waitForFunction((n) => document.body.innerText.includes(`第${n}轮`), next, { timeout: 6000 }).catch(() => fails.push("这一轮聊天没有回复完"));
      await page.waitForTimeout(900);
    };
    return { context, page, levels, say };
  };

  // 1) 同一档（Lv3）：不提示；后端升到 Lv4：这一轮结束提示一次；再聊一轮（仍 Lv4）不重复；刷新后再聊也不再提示
  {
    const { context, page, levels, say } = await open();
    await say();
    if (await toasts(page).count()) fails.push("没升档却出现了提示");
    levels.whale = 4;
    await say();
    const shown = await toasts(page).count();
    const text = shown ? await toasts(page).first().innerText() : "";
    if (shown !== 1 || !text.includes("好感度升到 Lv.4") || !text.includes("去看看她的新卡面")) fails.push(`升到 Lv4 应出现 1 条提示，实际 ${shown} 条「${text.replace(/\s+/g, " ")}」`);
    const seen = await page.evaluate(() => localStorage.getItem("wp.cardSeenLevel.whale"));
    if (seen !== "3") fails.push(`提示不该改「上次看到的等级」，实际 ${seen}`);
    await say();
    if ((await toasts(page).count()) !== 1) fails.push(`同一档不该再提示，当前 ${await toasts(page).count()} 条`);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await say();
    if (await toasts(page).count()) fails.push("刷新后同一档不该再提示");
    notes.push("Lv3 不提示；升到 Lv4 提示 1 次、seen 仍是 3；再聊 / 刷新后都不再提示");
    await context.close();
  }

  // 2) 点「去看看」：到设置页并打开「换一位」里的卡面，升级动画在那里播，播完才记成 Lv4
  {
    const { context, page, levels, say } = await open();
    levels.whale = 4;
    await say();
    await page.getByRole("button", { name: "去看看" }).click().catch(() => fails.push("提示里没有「去看看」"));
    await page.locator(".set-dialog--chars").waitFor({ timeout: 6000 }).catch(() => fails.push("点「去看看」后没有打开设置页的卡面"));
    if (!new URL(page.url()).pathname.startsWith("/settings")) fails.push(`点「去看看」应到设置页，实际 ${page.url()}`);
    if (new URL(page.url()).searchParams.has("card")) fails.push("进设置页后 ?card 参数没有清掉");
    await page.locator('.set-card .acard[data-upgrading="4"]').waitFor({ timeout: 6000 }).catch(() => fails.push("设置页卡面没有播 3→4"));
    notes.push("点「去看看」→ 设置页卡面打开并播 3→4");
    await context.close();
  }

  if (errors.length) fails.push(`页面报错：${errors.slice(0, 3).join(" | ")}`);
  return record("聊天页升档提示：跨档提示一次 / 同一档不重复 / 刷新不再出现 / 点击打开卡面", fails.length === 0, fails.length ? fails.join("；") : notes.join("；"));
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
  // 好感度卡（#159）：五档并排 × 亮/暗、四位角色 Lv4/Lv5、手机宽整页，外加四段升级各取中间一帧
  for (const theme of ["light", "dark"]) {
    const { context, page } = await openPage(browser, { width: 1440, height: 900, theme, motion: true });
    await visit(page, "/__kit/cards");
    const tiers = join(SHOTS, `cards-tiers-${theme}.png`);
    await page.locator('[data-testid="card-tiers"]').screenshot({ path: tiers });
    written.push(rel(tiers));
    if (theme === "light") {
      const sig = join(SHOTS, "cards-signatures.png");
      await page.locator('[data-testid="card-signatures"]').screenshot({ path: sig });
      written.push(rel(sig));
      const stage = page.locator(".cardkit__stage .acard");
      for (const [from, to] of [[1, 2], [2, 3], [3, 4], [4, 5]]) {
        await page.getByRole("button", { name: `${from}→${to}`, exact: true }).click();
        await page.evaluate(() => {
          for (const a of document.getAnimations()) {
            const t = a.effect?.getComputedTiming();
            a.pause();
            if (t && Number.isFinite(t.duration)) a.currentTime = (t.delay || 0) + t.duration * 0.45;
          }
        });
        const file = join(SHOTS, `cards-up-${from}${to}.png`);
        await stage.screenshot({ path: file });
        written.push(rel(file));
        await page.getByRole("button", { name: "跳过" }).click();
      }
    }
    await context.close();
  }
  // 设置页「换一位」弹窗：亮 / 暗各一张终态，亮色再拍一张升级中的一帧和缩略卡列表
  for (const theme of ["light", "dark"]) {
    const levels = { ...DEFAULT_LEVELS, whale: 4, deepseek: 3, claude: 2, chatgpt: 5 };
    const { context, page } = await openPage(browser, { width: 1280, height: 900, theme, motion: true, levels, character: "whale" });
    await page.addInitScript(() => { if (!sessionStorage.__shot) { sessionStorage.__shot = "1"; localStorage.setItem("wp.cardSeenLevel.whale", "4"); } });
    await visit(page, "/settings");
    await page.locator(".set-her__swap").click();
    const card = page.locator('.set-card .acard[data-size="md"]');
    await card.waitFor({ timeout: 8000 });
    await page.waitForTimeout(900);
    const dialog = page.locator(".set-dialog--chars");
    const file = join(SHOTS, `settings-card-${theme}.png`);
    await dialog.screenshot({ path: file });
    written.push(rel(file));
    if (theme === "light") {
      const thumbs = join(SHOTS, "settings-card-thumbs.png");
      await page.locator(".set-char").first().locator("xpath=..").screenshot({ path: thumbs });
      written.push(rel(thumbs));
      await page.keyboard.press("Escape");
      await page.locator(".set-dialog--chars").waitFor({ state: "detached", timeout: 4000 });
      await page.evaluate(() => localStorage.setItem("wp.cardSeenLevel.whale", "3"));
      await page.locator(".set-her__swap").click();
      await card.waitFor({ timeout: 8000 });
      await page.locator('.set-card .acard[data-upgrading]').waitFor({ timeout: 4000 });
      await card.evaluate((el) => {
        for (const a of el.getAnimations({ subtree: true })) {
          const t = a.effect?.getComputedTiming();
          a.pause();
          if (t && Number.isFinite(t.duration)) a.currentTime = (t.delay || 0) + t.duration * 0.45;
        }
      });
      const up = join(SHOTS, "settings-card-up.png");
      await dialog.screenshot({ path: up });
      written.push(rel(up));
    }
    await context.close();
  }
  {
    const { context, page } = await openPage(browser, { width: 390, height: 844, theme: "light" });
    await visit(page, "/__kit/cards");
    const file = join(SHOTS, "cards-390.png");
    await page.screenshot({ path: file, fullPage: true });
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
    if (ONLY === "drawer") {
      await checkBacklogStaysClosed(browser);
    } else if (ONLY === "polish") {
      await checkUiPolish(browser);
    } else if (ONLY === "memory") {
      await checkMemorySurfPages(browser);
      await checkMemoryRework(browser);
    } else if (ONLY === "card-live") {
      await checkCardLive(browser);
      await checkCardShared(browser);
      await checkChatLevelUp(browser);
      await checkCardView(browser);
    } else {
      await checkTouch(browser);
      await checkHorizontalScroll(browser);
      await checkShellNav(browser);
      await checkMobileKeyboard(browser);
      await checkChatGeometry(browser);
      await checkChatThreadFocus(browser);
      await checkBacklogStaysClosed(browser);
      await checkDiaryNav(browser);
      await checkMobileTabLabels(browser);
      await checkElderRailTargets(browser);
      await checkAxe(browser, AxeBuilder);
      await checkIdleAndHidden(browser);
      await checkLazyStyles(browser);
      await checkMemorySurfPages(browser);
      await checkMemoryRework(browser);
      await checkCardUpgrade(browser);
      await checkSettingsInteractions(browser);
      await checkCardLive(browser);
      await checkCardShared(browser);
      await checkChatLevelUp(browser);
      await checkCardView(browser);
      await checkUiPolish(browser);
    }
    if (WITH_SHOTS && !ONLY) {
      const written = await shoot(browser);
      record(`截图 ${written.length} 张（${PAGES.length} 页 × 亮/暗，预览页 × 角色 / 手机 / 老人 / 弹层，好感度卡五档 / 角色 / 升级帧）`, true, `${rel(SHOTS)}/`);
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
