/**
 * 记忆页 / 见闻页截图（#156 #157）：暗色主题，宽 1440×900、窄 900×900，各自走一遍
 * 列表、详情、空态、错误态。假后端，示例数据在 pages-fixtures.mjs，不连真实 API。
 *
 *   node scripts/pages-shots.mjs --label=before|after --out=<目录> [--base=http://127.0.0.1:14271]
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "./browser.mjs";
import { FIXTURES, NOW, relationshipBody, DEFAULT_LEVELS } from "./ui-fixtures.mjs";
import { MEMORY_ENTRIES, NOTE, SURF_ITEMS, surfFeed, thumbSvg } from "./pages-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const LABEL = arg("label", "after");
const OUT = resolve(arg("out", join(CLIENT, "test-results", "pages-shots")));
const BASE = arg("base", "http://127.0.0.1:14271").replace(/\/$/, "");
const PORT = new URL(BASE).port;

/** 点开详情用的选择器：改版前后类名不同。 */
const OPEN = {
  before: { memory: ".mcard__btn", surf: ".pcard__photo-btn" },
  after: { memory: "[data-memory-card]", surf: "[data-surf-open]" },
}[LABEL];

async function waitForServer(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(BASE, { signal: AbortSignal.timeout(2000) })).ok) return true; } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function stub(page, { memories = MEMORY_ENTRIES, memoryStatus = 200, surf = surfFeed(), surfStatus = 200 } = {}) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/api/surf/thumb/")) {
      const id = Number(url.split("/").pop()) || 0;
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: thumbSvg(id) });
    }
    if (url.includes("/api/health")) return json({ ok: true, provider: "stub", model: "stub" });
    if (url.includes("/api/chat/history")) return json(FIXTURES.history);
    if (url.includes("/api/diary")) return json(FIXTURES.diary);
    if (url.includes("/api/memories")) return memoryStatus === 200 ? json({ entries: memories }) : json({ error: "数据库暂时打不开" }, memoryStatus);
    if (url.includes("/api/note")) return json({ note: NOTE });
    if (url.includes("/api/relationship")) return json(relationshipBody(DEFAULT_LEVELS[new URL(url).searchParams.get("character")] ?? 1));
    if (url.includes("/api/quota")) return json(FIXTURES.quota);
    if (url.includes("/api/profile")) return json({ nickname: "阿明" });
    if (url.includes("/api/companion/settings")) return json({ enabled: true, frequency: "normal", quiet: { start: "23:00", end: "08:00" } });
    if (url.includes("/api/surf/feed")) {
      if (surfStatus !== 200) return json({ error: "见闻服务没有响应" }, surfStatus);
      const u = new URL(url);
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const kind = u.searchParams.get("kind");
      const site = u.searchParams.get("site");
      const items = surf.items.filter((i) => (!kind || i.kind === kind) && (!site || i.sourceSite === site) && (!q || `${i.title}${i.summary}`.toLowerCase().includes(q)));
      return json({ ...surf, items, total: items.length });
    }
    if (url.includes("/api/surf/settings")) return json({ character: "whale", enabled: true, frequency: "normal", interests: ["海洋", "手作"], blocked: [], quiet: { start: "23:00", end: "08:00" }, video: true, web: true, shareToChat: true, webAvailable: true, browser: { state: "ready", percent: null, message: "" } });
    if (url.includes("/api/surf/status")) return json({ running: false, sessionId: null, stage: null, todayCount: 3, lastRunAt: NOW, nextRunAt: "2026-11-06T16:00:00+11:00", pausedReason: null, webAvailable: true });
    if (url.includes("/api/devices")) return json({ devices: [] });
    if (url.includes("/api/accounts")) return json({ accounts: [] });
    return json({});
  });
}

const SIZES = [["wide", 1440, 900], ["narrow", 900, 900]];

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server = null;
  if (!(await waitForServer(1500))) {
    server = spawn("pnpm", ["--dir", "apps/client", "dev", "--port", PORT], { cwd: join(CLIENT, "..", ".."), stdio: "ignore", env: process.env });
    if (!(await waitForServer(60_000))) { server.kill("SIGTERM"); throw new Error(`dev server 起不来：${BASE}`); }
  }
  const require = createRequire(join(CLIENT, "package.json"));
  const pw = await import(pathToFileURL(require.resolve("playwright")).href);
  const chromium = pw.chromium ?? pw.default?.chromium;
  const browser = await launchChrome(chromium);
  const log = [];
  try {
    for (const [size, width, height] of SIZES) {
      const shot = async (name, route, opts, act) => {
        const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.addInitScript(() => { localStorage.setItem("wp.onboarded", "1"); localStorage.setItem("wp.theme", "dark"); localStorage.setItem("wp.character", "whale"); });
        await stub(page, opts);
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1400);
        if (act) await act(page);
        await page.waitForTimeout(500);
        const file = join(OUT, `${LABEL}-${name}-${size}.png`);
        await page.screenshot({ path: file, fullPage: false });
        log.push(file);
        await context.close();
      };
      await shot("memory", "/memory", {});
      await shot("memory-detail", "/memory", {}, (p) => p.locator(OPEN.memory).nth(2).click());
      await shot("memory-empty", "/memory", { memories: [] });
      await shot("memory-error", "/memory", { memoryStatus: 500 });
      await shot("surf", "/surf", {});
      await shot("surf-detail", "/surf", {}, (p) => p.locator(OPEN.surf).nth(0).click());
      await shot("surf-empty", "/surf", { surf: surfFeed([]) });
      await shot("surf-error", "/surf", { surfStatus: 500 });
    }
  } finally {
    await browser.close();
    server?.kill("SIGTERM");
  }
  console.log(log.join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
