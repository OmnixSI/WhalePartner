#!/usr/bin/env node
/**
 * 大肥鱼闪卡上的 Live2D：截图 + 粗测帧率与 CPU。有界面 Chrome（真实 GPU）打开构建产物，后端用假数据。
 *
 *   node scripts/card-live2d-check.mjs --dist=<dist> --out=<dir> [--port=14251] [--seconds=10] [--settle=6]
 *
 * 截图（真实等级 Lv5，五档都解锁）：
 *   card-lv1.png … card-lv5.png  用切档按钮切到各档后拍卡面
 *   tier-switch.png              弹窗里的卡面和切档按钮（看 Lv2 时）
 * 测量（各开新页，静置 settle 秒后量 seconds 秒）：
 *   chat       只有主界面舞台（聊天页）
 *   card       只有卡面舞台（设置页「换一位」弹窗）
 *   chat→card  从聊天页点进设置再打开弹窗：量的同时数页面上活着的 WebGL 上下文
 * 输出 fps、渲染进程 CPU、GPU 进程 CPU（单核百分比）和同时存在的 WebGL 上下文数，写进 out/perf.json。
 * Chrome 不等于 Tauri 的 WKWebView，数字只用来前后对比。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "./browser.mjs";
import { serveDist } from "./perf-idle.mjs";
import { stubApi, DEFAULT_LEVELS } from "./ui-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..");
const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? def;
const DIST = resolve(CLIENT, arg("dist", "dist"));
const OUT = resolve(arg("out", "card-live2d-out"));
const PORT = Number(arg("port", "14251"));
const SECONDS = Number(arg("seconds", "10"));
const SETTLE = Number(arg("settle", "6"));
const BASE = `http://127.0.0.1:${PORT}`;
const CARD = '.set-card .acard[data-size="md"]';

/** 应用脚本之前注入：数帧、记下每个 WebGL 上下文。 */
function instrument() {
  const s = (window.__wp = { frames: 0, lastTs: -1, gl: [] });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => { if (ts !== s.lastTs) { s.lastTs = ts; s.frames += 1; } cb(ts); });
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = get.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !s.gl.some((g) => g.ctx === ctx)) s.gl.push({ ctx, canvas: this });
    return ctx;
  };
  window.__liveGl = () => s.gl.filter((g) => g.canvas.isConnected && !g.ctx.isContextLost()).length;
}

async function newPage(browser, level) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await stubApi(page, { ...DEFAULT_LEVELS, deepseek: level });
  await page.addInitScript((lv) => {
    localStorage.setItem("wp.onboarded", "1");
    localStorage.setItem("wp.character", "deepseek");
    localStorage.setItem("wp.cardSeenLevel.deepseek", String(lv));
  }, level);
  await page.addInitScript(instrument);
  return { context, page };
}

async function openCard(page) {
  await page.locator(".set-her__swap").click();
  await page.waitForSelector(`${CARD} .acard__art .live2d[data-stage="ready"] canvas`, { timeout: 30_000 });
}

async function measure(browser, context, page) {
  const cdpBrowser = await browser.newBrowserCDPSession();
  const procs = async () => (await cdpBrowser.send("SystemInfo.getProcessInfo")).processInfo;
  const cpuOf = (list, type) => list.filter((p) => p.type === type).reduce((n, p) => n + p.cpuTime, 0);
  await page.waitForTimeout(SETTLE * 1000);
  const f0 = await page.evaluate(() => window.__wp.frames);
  const before = await procs();
  const t0 = Date.now();
  let maxGl = 0;
  while (Date.now() - t0 < SECONDS * 1000) {
    maxGl = Math.max(maxGl, await page.evaluate(() => window.__liveGl()));
    await page.waitForTimeout(500);
  }
  const after = await procs();
  const wall = (Date.now() - t0) / 1000;
  const frames = (await page.evaluate(() => window.__wp.frames)) - f0;
  const round = (x) => Number(x.toFixed(1));
  return {
    fps: round(frames / wall),
    rendererCpu: round(((cpuOf(after, "renderer") - cpuOf(before, "renderer")) / wall) * 100),
    gpuCpu: round(((cpuOf(after, "GPU") - cpuOf(before, "GPU")) / wall) * 100),
    liveWebGL: maxGl,
  };
}

const require = createRequire(join(CLIENT, "package.json"));
const pw = await import(pathToFileURL(require.resolve("playwright")).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const server = await serveDist(DIST, PORT);
const browser = await launchChrome(chromium, {
  headless: false,
  args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--window-position=0,0"],
});
mkdirSync(OUT, { recursive: true });
const perf = {};
try {
  // 截图：真实 Lv5，逐档切
  {
    const { context, page } = await newPage(browser, 5);
    await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
    await openCard(page);
    for (const n of [1, 2, 3, 4, 5]) {
      await page.locator(".card-view__btn", { hasText: `Lv.${n}` }).click();
      await page.waitForTimeout(2500);
      await page.locator(CARD).screenshot({ path: join(OUT, `card-lv${n}.png`) });
    }
    await page.locator(".card-view__btn", { hasText: "Lv.2" }).click();
    await page.locator(".card-view__btn", { hasText: "Lv.2" }).hover();
    await page.waitForTimeout(2500);
    await page.locator(".set-dialog--chars").screenshot({ path: join(OUT, "tier-switch.png") });
    await context.close();
  }
  // 只有主界面
  {
    const { context, page } = await newPage(browser, 5);
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForSelector('.live2d[data-stage="ready"] canvas', { timeout: 30_000 });
    perf.chat = await measure(browser, context, page);
    // 同一页从聊天点进设置再开卡面：主界面舞台应已卸下，只剩卡面一个上下文
    await page.evaluate(() => { history.pushState(null, "", "/settings"); dispatchEvent(new PopStateEvent("popstate")); });
    await page.waitForSelector(".set-her__swap", { timeout: 10_000 });
    await openCard(page);
    perf["chat→card"] = await measure(browser, context, page);
    await context.close();
  }
  // 只有卡面
  {
    const { context, page } = await newPage(browser, 5);
    await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
    await openCard(page);
    perf.card = await measure(browser, context, page);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(OUT, "perf.json"), JSON.stringify(perf, null, 2));
console.log(JSON.stringify(perf, null, 2));
