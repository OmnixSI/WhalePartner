#!/usr/bin/env node
/**
 * 重设计验收 · 一条命令跑完全部机器检查（规范 §12.2 / §12.3）。
 *
 *   node scripts/redesign/check.mjs              全跑（会自己起 vite dev，跑完关掉）
 *   node scripts/redesign/check.mjs --static     只跑源码检查，不开浏览器
 *   node scripts/redesign/check.mjs --shots      另外拍 docs/redesign/shots/P4/ 的 4 张页面
 *   node scripts/redesign/check.mjs --base=http://127.0.0.1:1420   复用已在跑的 dev server
 *
 * 检查项：
 *   1  对比度 90 组（亮/暗 × 4 角色，复用 check-contrast.mjs）
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
 * 退出码：0 全绿；1 有失败。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { contrastRows, scanBannedUsage, stripComments } from "./check-contrast.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CLIENT = join(ROOT, "apps", "client");
const SRC = join(CLIENT, "src");
const SHOTS = join(ROOT, "docs", "redesign", "shots", "P4");

const argv = process.argv.slice(2);
const STATIC_ONLY = argv.includes("--static");
const WITH_SHOTS = argv.includes("--shots");
const BASE = (argv.find((a) => a.startsWith("--base="))?.slice(7) || process.env.WP_BASE || "http://127.0.0.1:1420").replace(/\/$/, "");
const PORT = new URL(BASE).port || "1420";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  return ok;
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
  return record("对比度 90 组（亮/暗 × 4 角色）", failures.length === 0, failures.length ? failures.join("；") : `${rows.length} 组全部达标`);
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

// ---------- 3/5. 禁用样式 + 珊瑚色作文字（与 check-contrast.mjs 同一份实现） ----------
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
const RADIUS_OK = /^(var\(--r-[\w-]+\)|0|50%)$/;
function checkRadius() {
  const hits = [];
  for (const p of sourceFiles()) {
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

// ---------- 浏览器检查 ----------
const PAGES = [
  ["chat", "/"],
  ["diary", "/diary"],
  ["memory", "/memory"],
  ["settings", "/settings"],
];

const NOW = "2026-11-06T10:00:00+11:00";
const FIXTURES = {
  history: {
    messages: [
      { id: 1, role: "assistant", content: "你回来啦。今天海面很平，我在这里等你。", emotion: "happy", createdAt: NOW },
      { id: 2, role: "user", content: "刚下班，有点累。", emotion: null, createdAt: NOW },
      { id: 3, role: "assistant", content: "那就先坐一会儿。我把今天捡到的一颗小石头放在你手边了。", emotion: "relaxed", createdAt: NOW },
      { id: 4, role: "user", content: "谢谢。你今天做什么了？", emotion: null, createdAt: NOW },
      { id: 5, role: "assistant", content: "我把昨天看到的那个视频写成了日记，写在第三页。", emotion: "happy", createdAt: NOW },
      { id: 6, role: "user", content: "晚点我去看看。", emotion: null, createdAt: NOW },
    ],
  },
  diary: {
    items: [
      { id: 1, inputUrl: "https://www.bilibili.com/video/BV1xx411c7mD", bvid: "BV1xx411c7mD", title: "海边捡到的第一块玻璃", sourceUrl: null, summary: "一个把碎玻璃磨成小石头的短片。", diaryText: "今天看到一个把碎玻璃磨成小石头的短片。\n\n海浪一次次推上来，又退回去，玻璃就慢慢圆了。我想起你上次说的那句「有些事只是需要时间」。", status: "done", errorStage: null, error: null, memoryStatus: "saved", memoryError: null, createdAt: "2026-11-05T10:00:00+11:00", processedAt: "2026-11-05T10:02:00+11:00", duplicateOf: null },
      { id: 2, inputUrl: "https://www.bilibili.com/video/BV1yy411c7mE", bvid: "BV1yy411c7mE", title: "灯塔守夜人的一天", sourceUrl: null, summary: "守夜人怎么过一天。", diaryText: "守夜人一天只做三件事：擦灯、看海、记天气。他说，安静不是没有声音，是知道声音从哪来。", status: "done", errorStage: null, error: null, memoryStatus: "saved", memoryError: null, createdAt: "2026-11-04T10:00:00+11:00", processedAt: "2026-11-04T10:02:00+11:00", duplicateOf: null },
      { id: 3, inputUrl: "https://www.bilibili.com/video/BV1zz411c7mF", bvid: null, title: null, sourceUrl: null, summary: null, diaryText: null, status: "pending", errorStage: null, error: null, memoryStatus: null, memoryError: null, createdAt: "2026-11-06T09:00:00+11:00", processedAt: null, duplicateOf: null },
    ],
  },
  memories: {
    entries: [
      { id: "m1", text: "你下班回家的时候，通常先说一句「我回来了」。", kind: "fact", createdAt: "2026-11-05T10:00:00+11:00" },
      { id: "m2", text: "你说累的时候，更想有人陪着，而不是被建议。", kind: "fact", createdAt: "2026-11-03T10:00:00+11:00" },
      { id: "m3", text: "海边捡到玻璃的事，你听了很久。", kind: "experience", createdAt: "2026-11-02T10:00:00+11:00", source: "bilibili", title: "海边捡到的第一块玻璃", url: "https://www.bilibili.com/video/BV1xx411c7mD" },
      { id: "m4", text: "你不太喜欢在晚上做决定。", kind: "fact", createdAt: "2026-10-28T10:00:00+11:00" },
    ],
  },
  quota: {
    billing: "off", enforced: false,
    period: { start: "2026-11-01", end: "2026-11-30", resetsAt: "2026-12-01T00:00:00+11:00" },
    total: 1000, used: 320, remaining: 680, low: false,
    breakdown: { chat: 120, video: 100, web: 40, journal: 40, surf: 20 },
    costs: { chat: 2, video: 10, web: 4, journal: 6, surfVideo: 12, surfWeb: 5 },
    today: { used: 12 },
  },
};

async function stubApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/api/health")) return json({ ok: true, provider: "stub", model: "stub" });
    if (url.includes("/api/chat/history")) return json(FIXTURES.history);
    if (url.includes("/api/diary")) return json(FIXTURES.diary);
    if (url.includes("/api/memories")) return json(FIXTURES.memories);
    if (url.includes("/api/note")) return json({ note: { text: "今天在窗台上发现一只小螃蟹。", updatedAt: NOW } });
    if (url.includes("/api/quota")) return json(FIXTURES.quota);
    if (url.includes("/api/profile")) return json({ nickname: "阿明" });
    if (url.includes("/api/accounts")) return json({ accounts: [{ platform: "bilibili", name: "哔哩哔哩", connected: false, valid: null, savedAt: null }] });
    return json({});
  });
}

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

async function openPage(browser, { width, height, elder = false, theme = null }) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await context.newPage();
  await stubApi(page);
  // 引导是一次性全屏：截图与测量都要先标记「看过」，否则四页拍到的都是引导页
  await page.addInitScript(({ elder, theme }) => {
    localStorage.setItem("wp.onboarded", "1");
    if (elder) localStorage.setItem("wp.elder", "on");
    if (theme) localStorage.setItem("wp.theme", theme);
  }, { elder, theme });
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
  return written;
}

// ---------- 主流程 ----------
console.log(`重设计验收 · ${rel(resolve(fileURLToPath(import.meta.url)))}  ·  ${STATIC_ONLY ? "只跑源码检查" : BASE}\n`);

checkContrast();
checkObsoleteTokens();
checkBannedUsage();
checkNativeDialogs();
checkRadius();
checkMotionTokens();

if (STATIC_ONLY) {
  console.log("（--static：跳过浏览器检查：触控 / 横向滚动 / axe）\n");
} else {
  let server = null;
  try {
    const loaded = await ensureServer();
    server = loaded.child;
    const { chromium, AxeBuilder } = await loadPlaywright();
    const browser = await chromium.launch(process.env.WP_CHROME ? { executablePath: process.env.WP_CHROME } : {});
    await checkTouch(browser);
    await checkHorizontalScroll(browser);
    await checkAxe(browser, AxeBuilder);
    if (WITH_SHOTS) {
      const written = await shoot(browser);
      record("截图 4 页 × 亮/暗（1440×900）", true, written.join("、"));
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
