/**
 * P3 验收：设置页（桌面 / 手机 / 老人）+ 首次引导第 1 步 + axe 扫描。
 *
 * 跑法：
 *   1) cd apps/client && pnpm exec vite preview --port 4319 --strictPort
 *   2) node docs/redesign/shots/P3/shoot.mjs
 *
 * 本机没有起 apps/api，所以这里按规范 §12.1 用 `page.route` 喂**固定数据桩**
 * （只是为了拍出"有数"的样子）；页面本身在接口失败时走「现在拿不到」，另有 offline 一张为证。
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP = "/Users/yanghongming/Downloads/whale-P3/apps/client";
const requireFromApp = createRequire(`${APP}/package.json`);
const playwright = await import(requireFromApp.resolve("playwright"));
const chromium = playwright.chromium ?? playwright.default?.chromium;
const axeMod = await import(`${APP}/node_modules/@axe-core/playwright/dist/index.mjs`);
const AxeBuilder = axeMod.AxeBuilder ?? axeMod.default;

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WP_BASE ?? "http://127.0.0.1:4183";

/* ---------------- 固定数据桩（只用于截图，数字形状与 lib/quota.ts 的类型一致） ---------------- */
const QUOTA = {
  billing: "off",
  enforced: true,
  period: { start: "2026-11-01", end: "2026-11-30", resetsAt: "2026-12-01T00:00:00+11:00" },
  total: 3000,
  used: 412,
  remaining: 2588,
  low: false,
  breakdown: { chat: 180, video: 100, web: 12, journal: 20, surf: 100 },
  costs: { chat: 1, video: 10, web: 1, journal: 2, surfVideo: 10, surfWeb: 1 },
  today: { used: 6 },
};
const PROFILE = { nickname: "小周" };

const browser = await chromium.launch();

/** 一次拍摄：context 级 initScript 决定 localStorage 初值，route 决定接口返回。 */
async function shoot({ name, path, width, height, elder = false, onboarded = true, offline = false, reducedMotion = "no-preference" }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Australia/Sydney",
    reducedMotion,
  });

  await context.addInitScript(
    ({ elder, onboarded }) => {
      const store = window.localStorage;
      if (elder) {
        store.setItem("wp.elder", "on");
        store.setItem("wp.scale", "1.25");
        store.setItem("wp.motion", "calm");
      } else {
        store.setItem("wp.elder", "off");
        store.setItem("wp.scale", "1");
        store.setItem("wp.motion", "full");
      }
      if (onboarded) store.setItem("wp.onboarded", "1");
      else store.removeItem("wp.onboarded");
      store.setItem("wp.theme", "light");
    },
    { elder, onboarded },
  );

  const page = await context.newPage();

  if (offline) {
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, body: "{}" }));
  } else {
    await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, provider: "stub", model: "stub" } }));
    await page.route("**/api/quota", (route) => route.fulfill({ json: QUOTA }));
    await page.route("**/api/profile", (route) => route.fulfill({ json: PROFILE }));
    await page.route("**/api/accounts**", (route) => route.fulfill({ json: { accounts: [] } }));
    await page.route("**/api/note**", (route) => route.fulfill({ json: { note: null } }));
  }

  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);

  await page.screenshot({ path: `${HERE}/${name}.png`, fullPage: false });

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const targets = [];
    for (const el of document.querySelectorAll("button, a[href], input, select, textarea, summary, [role=switch]")) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      targets.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().split(" ")[0] || "-",
        text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 16),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        minHeight: getComputedStyle(el).minHeight,
      });
    }
    const doc = document.scrollingElement ?? root;
    const scroller = document.querySelector(".page");
    return {
      rootFontSize: css.fontSize,
      hit: css.getPropertyValue("--hit").trim(),
      scale: css.getPropertyValue("--scale").trim(),
      elder: root.getAttribute("data-elder"),
      motion: root.getAttribute("data-motion"),
      navLinks: [...document.querySelectorAll(".nav__link")].filter(visible).map((el) => (el.textContent || "").trim()),
      horizontalScroll:
        Math.max(doc.scrollWidth - doc.clientWidth, scroller ? scroller.scrollWidth - scroller.clientWidth : 0),
      targets,
    };
  });

  return { name, page, context, metrics };
}

const results = [];

/** 1) 桌面设置页 */
{
  const { name, page, context, metrics } = await shoot({ name: "settings-desktop", path: "/settings", width: 1180, height: 780 });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  results.push({ name, metrics, axe: summarise(axe) });
  await context.close();
}

/** 2) 手机设置页 */
{
  const { name, page, context, metrics } = await shoot({ name: "settings-mobile", path: "/settings", width: 390, height: 844 });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  results.push({ name, metrics, axe: summarise(axe) });
  await context.close();
}

/** 3) 老人模式下的设置页 */
{
  const { name, page, context, metrics } = await shoot({
    name: "settings-elder",
    path: "/settings",
    width: 1180,
    height: 780,
    elder: true,
    reducedMotion: "reduce",
  });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  results.push({ name, metrics, axe: summarise(axe) });
  await context.close();
}

/** 4) 引导第 1 步（桌面 + 手机） */
for (const [name, width, height] of [
  ["onboarding-step1", 1180, 780],
  ["onboarding-step1-mobile", 390, 844],
]) {
  const { page, context, metrics } = await shoot({ name, path: "/settings", width, height, onboarded: false });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  results.push({ name, metrics, axe: summarise(axe) });
  await context.close();
}

/** 5) 后端不在时的设置页（「现在拿不到」） */
{
  const { name, context, metrics } = await shoot({ name: "settings-offline", path: "/settings", width: 1180, height: 780, offline: true });
  results.push({ name, metrics, axe: null });
  await context.close();
}

await browser.close();

function summarise(axe) {
  return {
    violations: axe.violations.length,
    list: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    })),
    incomplete: axe.incomplete.length,
  };
}

/* ---------------- 断言 ---------------- */
const problems = [];
for (const result of results) {
  const { name, metrics } = result;
  if (metrics.horizontalScroll > 0) problems.push(`${name}: 横向滚动 ${metrics.horizontalScroll}px`);
  if (name === "settings-elder") {
    if (metrics.rootFontSize !== "20px") problems.push(`${name}: 根字号 ${metrics.rootFontSize}，应为 20px`);
    if (metrics.hit !== "56px") problems.push(`${name}: --hit ${metrics.hit}，应为 56px`);
    if (metrics.navLinks.length !== 3) problems.push(`${name}: 导航 ${metrics.navLinks.length} 项（${metrics.navLinks.join("/")}），应为 3`);
    const tooSmall = metrics.targets.filter((t) => t.h < 56);
    if (tooSmall.length) problems.push(`${name}: ${tooSmall.length} 个元素不足 56：${tooSmall.map((t) => `${t.cls} ${t.h}`).join(", ")}`);
  } else {
    const tooSmall = metrics.targets.filter((t) => t.tag !== "input" && t.tag !== "textarea" && t.h < 44);
    if (tooSmall.length) problems.push(`${name}: ${tooSmall.length} 个元素不足 44：${tooSmall.map((t) => `${t.cls} ${t.h}`).join(", ")}`);
  }
  if (result.axe && result.axe.violations > 0) {
    problems.push(`${name}: axe ${result.axe.violations} 条 —— ${result.axe.list.map((v) => `${v.id}(${v.impact})`).join(", ")}`);
  }
}

const report = results.map(({ name, metrics, axe }) => ({
  name,
  rootFontSize: metrics.rootFontSize,
  hit: metrics.hit,
  scale: metrics.scale,
  elder: metrics.elder,
  motion: metrics.motion,
  navLinks: metrics.navLinks,
  horizontalScrollPx: metrics.horizontalScroll,
  targets: metrics.targets.length,
  axe,
}));

await mkdir(HERE, { recursive: true });
await writeFile(`${HERE}/metrics.json`, JSON.stringify({ report, problems }, null, 2));
console.log(JSON.stringify({ report, problems }, null, 2));
if (problems.length) process.exitCode = 1;
