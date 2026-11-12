#!/usr/bin/env node
/**
 * Live2D 每帧开销：有界面 Chrome（真实 GPU）打开聊天页的大肥鱼，分三段量：
 *   idle      静置
 *   interact  指针在舞台上持续画圈，每 2 秒点一下立绘
 *   speak     发一句话，假后端回一段长回复，口型一直在动
 *
 *   node scripts/perf-live2d.mjs --dist=<dist> [--port=14251] [--runs=3] [--seconds=10] [--settle=8]
 *                                [--gl] [--profile=<out.json>] [--shots=<dir>] [--headless] [--json]
 *
 * 每段输出（runs 次取中位数）：
 *   fps                rAF 帧数 / 墙钟
 *   frameMs            每帧 rAF 回调里的 JS 耗时（Live2D 更新 + 提交 GL 命令），均值与 p95
 *   updateMs / drawMs  其中模型更新（动作、物理、Cubism Core）和绘制（doDrawModel）各占多少
 *   rendererCpu / gpuCpu  渲染进程、GPU 进程的 CPU 占用（单核百分比）
 *   gpuUtil            ioreg「Device Utilization %」均值（整机 GPU，含桌面合成，只适合前后对比）
 *   --gl               另跑一遍，统计每帧 GL 调用（会拖慢计时，所以和计时分开跑）
 *   --profile          每段一份 CPU 采样，按函数自耗时排序写进文件
 *
 * 数字只在同一台机器、同一份脚本下前后对比才有意义；Chrome 不等于 Tauri 的 WKWebView。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "./browser.mjs";
import { serveDist } from "./perf-idle.mjs";
import { stubApi } from "./ui-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..");
const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const has = (name) => process.argv.includes(`--${name}`);
const DIST = resolve(CLIENT, arg("dist", "dist"));
const PORT = Number(arg("port", "14251"));
const RUNS = Number(arg("runs", "3"));
const SECONDS = Number(arg("seconds", "10"));
const SETTLE = Number(arg("settle", "8"));
const PROFILE = arg("profile", "");
const SHOTS = arg("shots", "");
const STATES = arg("states", "idle,interact,speak").split(",");

const REPLY = "今天的海风有一点咸，我在窗台上数了数，一共来了三只海鸥。".repeat(14);

/** 页面里装帧计数：每帧 rAF 回调的 JS 耗时。必须在应用脚本之前注入。 */
function instrumentFrames(countGl) {
  const s = (window.__wpFrames = { frames: 0, lastTs: -1, cur: 0, costs: [], gl: {}, glFrames: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => {
    if (ts !== s.lastTs) {
      if (s.lastTs >= 0) s.costs.push(s.cur);
      s.lastTs = ts; s.cur = 0; s.frames += 1;
    }
    const t0 = performance.now();
    try { cb(ts); } finally { s.cur += performance.now() - t0; }
  });
  if (!countGl) return;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      const d = Object.getOwnPropertyDescriptor(proto, key);
      if (!d || typeof d.value !== "function" || key === "constructor") continue;
      const fn = d.value;
      proto[key] = function (...a) { s.gl[key] = (s.gl[key] ?? 0) + 1; return fn.apply(this, a); };
    }
  }
}

/** 把 Live2D 一帧拆成「模型更新」和「绘制」两段计时（只包住这两个调用，不影响其它）。 */
function splitLive2D() {
  let l = window.PIXI?.Ticker.shared._head;
  let model;
  while (l) { if (l.context?.internalModel) model = l.context; l = l.next; }
  const s = (window.__wpSplit = { update: 0, draw: 0, n: 0 });
  if (!model) return;
  const im = model.internalModel;
  const update = im.update.bind(im);
  im.update = (...a) => { const t = performance.now(); try { return update(...a); } finally { s.update += performance.now() - t; s.n += 1; } };
  const r = im.renderer;
  const draw = r.doDrawModel.bind(r);
  r.doDrawModel = () => { const t = performance.now(); try { return draw(); } finally { s.draw += performance.now() - t; } };
}

function gpuUtil() {
  try {
    const out = execFileSync("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]).toString();
    const m = out.match(/"Device Utilization %"=(\d+)/);
    return m ? Number(m[1]) : NaN;
  } catch { return NaN; }
}

const median = (xs) => { const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (xs) => xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length);
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] ?? NaN; };

async function openPage(chromium, base, { countGl }) {
  const browser = await launchChrome(chromium, {
    headless: has("headless"),
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--window-position=0,0"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await stubApi(page);
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    const req = JSON.parse(route.request().postData() || "{}");
    const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    const body = ev("ack", { clientId: req.clientId, sessionId: "perf" }) + ev("delta", { text: REPLY }) + ev("done", { messageId: 9001, sessionId: "perf", emotion: "neutral" });
    return route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body });
  });
  await page.addInitScript(() => {
    localStorage.setItem("wp.onboarded", "1");
    localStorage.setItem("wp.character", "deepseek");
  });
  await page.addInitScript(instrumentFrames, countGl);
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForSelector('.live2d[data-stage="ready"] canvas', { timeout: 30_000 });
  await page.evaluate(splitLive2D);
  await page.waitForTimeout(SETTLE * 1000);
  return { browser, context, page };
}

async function measureWindow(browser, context, page, state, { profile }) {
  const cdpBrowser = await browser.newBrowserCDPSession();
  const cdp = await context.newCDPSession(page);
  const procs = async () => (await cdpBrowser.send("SystemInfo.getProcessInfo")).processInfo;
  const cpuOf = (list, type) => list.filter((p) => p.type === type).reduce((n, p) => n + p.cpuTime, 0);
  const box = await page.locator(".live2d canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.55;

  if (state === "speak") {
    const input = page.locator("textarea").first();
    await input.fill("讲讲今天的海边吧");
    await input.press("Enter");
    await page.waitForTimeout(1500);
  }
  if (profile) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }

  const f0 = await page.evaluate(() => { const s = window.__wpFrames; s.costs = []; s.gl = {}; Object.assign(window.__wpSplit, { update: 0, draw: 0, n: 0 }); return s.frames; });
  const before = await procs();
  const util = [];
  const t0 = Date.now();
  let lastTap = t0;
  let angle = 0;
  while (Date.now() - t0 < SECONDS * 1000) {
    if (state === "interact") {
      angle += 0.12;
      await page.mouse.move(cx + Math.cos(angle) * box.width * 0.35, cy + Math.sin(angle) * box.height * 0.3);
      if (Date.now() - lastTap > 2000) { lastTap = Date.now(); await page.mouse.click(cx, box.y + box.height * 0.6); }
      if (util.length < (Date.now() - t0) / 500) util.push(gpuUtil());
    } else {
      util.push(gpuUtil());
      await page.waitForTimeout(500);
    }
  }
  const after = await procs();
  const wall = (Date.now() - t0) / 1000;
  const s = await page.evaluate(() => { const s = window.__wpFrames; return { frames: s.frames, costs: s.costs, gl: s.gl, split: { ...window.__wpSplit }, speaking: document.querySelector(".chat-scene, .scene")?.className ?? "" }; });
  let prof = null;
  if (profile) {
    const { profile: p } = await cdp.send("Profiler.stop");
    const self = new Map();
    const dt = new Map();
    p.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));
    for (const n of p.nodes) {
      const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
      self.set(k, (self.get(k) ?? 0) + (dt.get(n.id) ?? 0) / 1000);
    }
    prof = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, ms]) => [k, Number((ms / wall).toFixed(2))]);
  }
  const frames = s.frames - f0;
  const glPerFrame = Object.fromEntries(Object.entries(s.gl).map(([k, v]) => [k, Number((v / Math.max(1, frames)).toFixed(1))]).sort((a, b) => b[1] - a[1]));
  return {
    fps: frames / wall,
    frameMs: mean(s.costs),
    frameP95: p95(s.costs),
    updateMs: s.split.update / Math.max(1, s.split.n),
    drawMs: s.split.draw / Math.max(1, s.split.n),
    rendererCpu: ((cpuOf(after, "renderer") - cpuOf(before, "renderer")) / wall) * 100,
    gpuCpu: ((cpuOf(after, "GPU") - cpuOf(before, "GPU")) / wall) * 100,
    gpuUtil: mean(util.filter(Number.isFinite)),
    glPerFrame,
    glTotal: Object.values(glPerFrame).reduce((n, v) => n + v, 0),
    profileMsPerSec: prof,
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
  const results = Object.fromEntries(STATES.map((s) => [s, []]));
  const gl = {};
  const profiles = {};
  try {
    for (let i = 0; i < RUNS; i += 1) {
      for (const state of STATES) {
        // 每段都开新页：说话段会改变对话状态，点击会触发动作，互不干扰
        const { browser, context, page } = await openPage(chromium, base, { countGl: false });
        try {
          results[state].push(await measureWindow(browser, context, page, state, { profile: PROFILE && i === 0 }));
          if (PROFILE && i === 0) profiles[state] = results[state].at(-1).profileMsPerSec;
          if (SHOTS && i === 0) { mkdirSync(SHOTS, { recursive: true }); await page.locator(".live2d").screenshot({ path: join(SHOTS, `${state}.png`) }); }
        } finally { await browser.close(); }
      }
    }
    if (has("gl")) {
      for (const state of STATES) {
        const { browser, context, page } = await openPage(chromium, base, { countGl: true });
        try { gl[state] = (await measureWindow(browser, context, page, state, { profile: false })); } finally { await browser.close(); }
      }
    }
  } finally {
    server.close();
  }
  const summary = Object.fromEntries(STATES.map((state) => {
    const rs = results[state];
    const pick = (k) => Number(median(rs.map((r) => r[k])).toFixed(3));
    return [state, {
      fps: pick("fps"), frameMs: pick("frameMs"), frameP95: pick("frameP95"), updateMs: pick("updateMs"), drawMs: pick("drawMs"),
      rendererCpu: pick("rendererCpu"), gpuCpu: pick("gpuCpu"), gpuUtil: pick("gpuUtil"),
      all: rs.map((r) => ({ fps: +r.fps.toFixed(1), frameMs: +r.frameMs.toFixed(3), rendererCpu: +r.rendererCpu.toFixed(1), gpuCpu: +r.gpuCpu.toFixed(1), gpuUtil: +r.gpuUtil.toFixed(1) })),
      ...(gl[state] ? { glTotal: gl[state].glTotal, glPerFrame: gl[state].glPerFrame } : {}),
    }];
  }));
  if (PROFILE) writeFileSync(PROFILE, JSON.stringify(profiles, null, 2));
  if (has("json")) console.log(JSON.stringify({ dist: DIST, seconds: SECONDS, runs: RUNS, summary }, null, 2));
  else {
    for (const [state, r] of Object.entries(summary)) {
      console.log(`${state.padEnd(9)} fps ${r.fps.toFixed(1)}  帧内 JS ${r.frameMs.toFixed(2)} ms（p95 ${r.frameP95.toFixed(2)}）  更新 ${r.updateMs.toFixed(3)}  绘制 ${r.drawMs.toFixed(3)} ms  渲染进程 ${r.rendererCpu.toFixed(1)}%  GPU 进程 ${r.gpuCpu.toFixed(1)}%  GPU 占用 ${r.gpuUtil.toFixed(1)}%${r.glTotal ? `  GL 调用/帧 ${r.glTotal.toFixed(0)}` : ""}`);
    }
  }
}
