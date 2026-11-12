#!/usr/bin/env node
/**
 * 空闲 CPU 与渲染进程内存：把构建好的 dist 放进一个只读静态服务器（假后端，不连 8787），
 * 用本机 Chrome 无头打开聊天页，静置后量一段时间。
 *
 *   node scripts/perf-idle.mjs --dist=dist [--port=14260] [--runs=3] [--seconds=30] [--settle=8]
 *                              [--path=/] [--character=whale] [--json]
 *
 * 输出（取 runs 次的中位数）：
 *   - 首屏体积（同 perf-budget.mjs）
 *   - 空闲 CPU：静置窗口里 renderer 与 GPU 进程 cpuTime 的增量 / 墙钟时间
 *   - 渲染进程内存：窗口结束时 renderer 进程 RSS（ps）与 GC 后的 JS 堆（Performance.getMetrics）；body 内元素数
 *   - 空闲时仍在跑的动画数、定时器触发次数（可见 / 隐藏两种状态）
 *
 * 数字只在同一台机器、同一份脚本下前后对比才有意义；Chrome 不等于 Tauri 的 WKWebView。
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "./browser.mjs";
import { firstScreen, kb } from "./perf-budget.mjs";
import { stubApi } from "./ui-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..");
const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const DIST = resolve(CLIENT, arg("dist", "dist"));
const PORT = Number(arg("port", "14260"));
const RUNS = Number(arg("runs", "3"));
const SECONDS = Number(arg("seconds", "30"));
const SETTLE = Number(arg("settle", "8"));
const PATH = arg("path", "/");
const CHARACTER = arg("character", "whale");
const JSON_OUT = process.argv.includes("--json");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".moc3": "application/octet-stream" };

/** 只读静态服务器：dist 里有就给文件，没有就回 index.html（前端路由）。 */
export function serveDist(dist, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let file = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

/** 页面里装计数器：定时器回调、rAF 回调各触发了几次。必须在应用脚本之前注入。 */
export function instrumentTimers() {
  const c = (window.__wpTimers = { timeout: 0, interval: 0, raf: 0 });
  const wrap = (fn, key) => (cb, ...rest) => fn((...a) => { c[key] += 1; return typeof cb === "function" ? cb(...a) : undefined; }, ...rest);
  window.setTimeout = wrap(window.setTimeout.bind(window), "timeout");
  window.setInterval = wrap(window.setInterval.bind(window), "interval");
  window.requestAnimationFrame = wrap(window.requestAnimationFrame.bind(window), "raf");
  // 让测试能把页面切到「隐藏」：覆盖 visibilityState / hidden，再发 visibilitychange
  let hidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  window.__wpSetHidden = (v) => { hidden = v; document.dispatchEvent(new Event("visibilitychange")); };
}

/** 页面上此刻仍在跑的动画（Web Animations 视角：CSS 动画、过渡、WAAPI）。 */
export function runningAnimations() {
  return document.getAnimations()
    .filter((a) => a.playState === "running")
    .map((a) => {
      const el = a.effect?.target;
      const cls = el && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : el?.tagName?.toLowerCase() ?? "?";
      const name = a.animationName || a.transitionProperty || a.id || "waapi";
      const iter = a.effect?.getTiming?.().iterations;
      return `${cls}:${name}${iter === Infinity ? "∞" : ""}`;
    });
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function measureOnce(chromium, base) {
  const browser = await launchChrome(chromium, { args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await stubApi(page);
  await page.addInitScript((character) => {
    localStorage.setItem("wp.onboarded", "1");
    localStorage.setItem("wp.character", character);
  }, CHARACTER);
  await page.addInitScript(instrumentTimers);
  await page.goto(base + PATH, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE * 1000);

  const cdpBrowser = await browser.newBrowserCDPSession();
  const cdpPage = await context.newCDPSession(page);
  await cdpPage.send("Performance.enable");
  const procs = async () => (await cdpBrowser.send("SystemInfo.getProcessInfo")).processInfo;
  const cpu = (list) => list.filter((p) => p.type === "renderer" || p.type === "GPU").reduce((n, p) => n + p.cpuTime, 0);

  const before = await procs();
  const timersBefore = await page.evaluate(() => ({ ...window.__wpTimers }));
  const t0 = Date.now();
  await page.waitForTimeout(SECONDS * 1000);
  const after = await procs();
  const wall = (Date.now() - t0) / 1000;
  const timersAfter = await page.evaluate(() => ({ ...window.__wpTimers }));
  const anims = await page.evaluate(runningAnimations);

  const renderers = after.filter((p) => p.type === "renderer").map((p) => p.id);
  let rssKb = 0;
  for (const pid of renderers) {
    try { rssKb = Math.max(rssKb, Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) || 0); } catch { /* 进程已退出 */ }
  }
  // 先强制 GC 再读堆：否则读数取决于这一刻 GC 跑没跑，前后比较没有意义
  await cdpPage.send("HeapProfiler.collectGarbage");
  const metrics = Object.fromEntries((await cdpPage.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  // 页面 DOM：body 里的活元素数（Performance 的 Nodes 含待回收节点，随 GC 时机波动）
  const bodyElements = await page.evaluate(() => document.body.getElementsByTagName("*").length);

  // 隐藏状态：切到 hidden 后再量 5 秒，动画与定时器都应该停
  await page.evaluate(() => window.__wpSetHidden(true));
  await page.waitForTimeout(500);
  const hiddenStart = await page.evaluate(() => ({ ...window.__wpTimers }));
  await page.waitForTimeout(5000);
  const hiddenEnd = await page.evaluate(() => ({ ...window.__wpTimers }));
  const hiddenAnims = await page.evaluate(runningAnimations);

  await browser.close();
  const fired = (a, b) => (b.timeout - a.timeout) + (b.interval - a.interval) + (b.raf - a.raf);
  return {
    cpuPct: ((cpu(after) - cpu(before)) / wall) * 100,
    rssMb: rssKb / 1024,
    heapMb: metrics.JSHeapUsedSize / 1024 / 1024,
    domNodes: bodyElements,
    idleAnimations: anims,
    idleTimerFires: fired(timersBefore, timersAfter),
    hiddenAnimations: hiddenAnims,
    hiddenTimerFires: fired(hiddenStart, hiddenEnd),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!existsSync(join(DIST, "index.html"))) { console.error(`找不到 ${DIST}/index.html，先 build`); process.exit(1); }
  const require = createRequire(join(CLIENT, "package.json"));
  const pw = await import(pathToFileURL(require.resolve("playwright")).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  const server = await serveDist(DIST, PORT);
  const base = `http://127.0.0.1:${PORT}`;
  const runs = [];
  try {
    for (let i = 0; i < RUNS; i += 1) runs.push(await measureOnce(chromium, base));
  } finally {
    server.close();
  }
  const fs = firstScreen(DIST);
  const out = {
    dist: DIST,
    path: PATH,
    character: CHARACTER,
    seconds: SECONDS,
    runs: RUNS,
    firstScreen: { jsRaw: fs.js.raw, jsGzip: fs.js.gzip, cssRaw: fs.css.raw, cssGzip: fs.css.gzip },
    cpuPct: median(runs.map((r) => r.cpuPct)),
    cpuPctAll: runs.map((r) => Number(r.cpuPct.toFixed(2))),
    rssMb: median(runs.map((r) => r.rssMb)),
    heapMb: median(runs.map((r) => r.heapMb)),
    heapMbAll: runs.map((r) => Number(r.heapMb.toFixed(2))),
    rssMbAll: runs.map((r) => Number(r.rssMb.toFixed(1))),
    domNodes: median(runs.map((r) => r.domNodes)),
    idleTimerFires: median(runs.map((r) => r.idleTimerFires)),
    hiddenTimerFires: median(runs.map((r) => r.hiddenTimerFires)),
    idleAnimations: runs[0].idleAnimations,
    hiddenAnimations: runs[0].hiddenAnimations,
  };
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`dist ${DIST}  页面 ${PATH}  角色 ${CHARACTER}  每次静置 ${SECONDS}s × ${RUNS} 次（中位数）`);
    console.log(`首屏 JS  ${kb(fs.js.raw)}（gzip ${kb(fs.js.gzip)}）  CSS ${kb(fs.css.raw)}（gzip ${kb(fs.css.gzip)}）`);
    console.log(`空闲 CPU ${out.cpuPct.toFixed(2)}%（各次 ${out.cpuPctAll.join(" / ")}）`);
    console.log(`渲染进程 RSS ${out.rssMb.toFixed(1)} MB  JS 堆 ${out.heapMb.toFixed(1)} MB  DOM 节点 ${out.domNodes}`);
    console.log(`空闲 ${SECONDS}s 定时器/rAF 触发 ${out.idleTimerFires} 次；仍在跑的动画 ${out.idleAnimations.length}：${out.idleAnimations.join("、") || "无"}`);
    console.log(`隐藏 5s 定时器/rAF 触发 ${out.hiddenTimerFires} 次；仍在跑的动画 ${out.hiddenAnimations.length}：${out.hiddenAnimations.join("、") || "无"}`);
  }
}
