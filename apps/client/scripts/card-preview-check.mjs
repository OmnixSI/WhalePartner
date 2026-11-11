import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.WP_CARD_PREVIEW_URL ?? "http://127.0.0.1:1420/character-cards.html";
const shots = fileURLToPath(new URL("../test-results/card-preview/", import.meta.url));
const browser = await chromium.launch({ channel: "chrome" });

try {
  await mkdir(shots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  const apiRequests = [];
  const live2dRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} ${JSON.stringify(message.location())}`);
  });
  page.on("requestfailed", (request) => errors.push(`${request.failure()?.errorText} ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(request.url());
    if (url.pathname.startsWith("/live2d/")) live2dRequests.push(url.pathname);
  });
  await page.addInitScript(() => localStorage.setItem("wp.character", "claude"));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  assert.equal(await page.getByRole("heading", { name: "角色闪卡" }).count(), 1);
  assert.equal(await page.locator(".card-preview__card").count(), 4);
  assert.equal(await page.getByRole("button", { name: /预览等级/ }).count(), 4);
  assert.match(await page.locator("body").innerText(), /固定演示值，不代表真实账号/);
  assert.equal(await page.locator(".card-preview__hero").getAttribute("data-level"), "4");
  assert.equal(await page.locator(".card-preview__hero-top, .card-preview__hero-copy, .card-preview__hero-art-caption").count(), 0);
  assert.equal(await page.locator(".card-preview__card-name, .card-preview__latin, .card-preview__model, .card-preview__rarity").count(), 0);
  assert.match(await page.locator(".card-preview__card").first().getAttribute("aria-label"), /选择/);
  await page.locator(".card-preview__hero-model .live2d[data-stage='ready']").waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await page.locator(".card-preview__hero-model canvas").count(), 1);
  const modelHeightRatio = await page.locator(".card-preview__hero-model .live2d").evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--stage-char-h")));
  const modelWidthRatio = await page.locator(".card-preview__hero-model .live2d").evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--stage-char-w")));
  assert.ok(modelHeightRatio >= 1.15, `card model height ratio is too small: ${modelHeightRatio}`);
  assert.ok(modelWidthRatio >= 1.29, `card model width ratio is too small: ${modelWidthRatio}`);
  const live2dRenderRate = await page.evaluate(async () => {
    const ticker = window.PIXI?.Ticker.shared;
    if (!ticker) throw new Error("Live2D shared Pixi ticker is unavailable");
    let frames = 0;
    const countFrame = () => { frames += 1; };
    ticker.add(countFrame);
    const startedAt = performance.now();
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
    ticker.remove(countFrame);
    const elapsedMs = performance.now() - startedAt;
    return { frames, elapsedMs: Math.round(elapsedMs), fps: Math.round(frames / elapsedMs * 1000 * 10) / 10 };
  });
  assert.ok(live2dRenderRate.frames > 0, "Live2D ticker must render animation frames");
  console.log("LIVE2D_RENDER_RATE", JSON.stringify(live2dRenderRate));
  assert.ok(live2dRequests.includes("/live2d/whale-maid/c_0120.model3.json"));
  assert.ok(live2dRequests.includes("/live2d/libs/live2dcubismcore.min.js"));
  assert.match(await page.locator(".card-preview__model-status").innerText(), /Live2D 已载入/);
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.character")), "claude");

  const initialFontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.evaluate(() => document.documentElement.style.setProperty("--scale", "1.25"));
  const scaledFontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  assert.ok(scaledFontSize > initialFontSize);
  await page.evaluate(() => document.documentElement.style.removeProperty("--scale"));

  await page.locator(".card-preview__hero").hover({ position: { x: 42, y: 128 } });
  await page.waitForTimeout(250);
  assert.notEqual(await page.locator(".card-preview__hero").getAttribute("data-tilt-y"), "0");
  await page.screenshot({ path: `${shots}/desktop-level4-1440x960.png`, fullPage: true });
  await page.locator(".card-preview__hero").screenshot({ path: `${shots}/hero-card-lv4-exclusive.png` });

  const modelLoadCount = live2dRequests.filter((path) => path === "/live2d/whale-maid/c_0120.model3.json").length;
  await page.getByRole("button", { name: "预览等级 1：相识" }).click();
  assert.equal(await page.locator(".card-preview__hero").getAttribute("data-level"), "1");
  assert.equal(await page.locator(".card-preview__particles").count(), 0);
  assert.equal(await page.getByRole("button", { name: /选择小克/ }).isEnabled(), true);
  await page.screenshot({ path: `${shots}/desktop-locked-1440x960.png`, fullPage: true });

  await page.getByRole("button", { name: "预览等级 2：相熟" }).click();
  assert.equal(await page.locator(".card-preview__hero").getAttribute("data-level"), "2");
  await page.locator(".card-preview__hero").hover({ position: { x: 42, y: 128 } });
  await page.waitForTimeout(250);
  assert.notEqual(await page.locator(".card-preview__hero").getAttribute("data-tilt-x"), "0");
  await page.locator(".card-preview__hero").screenshot({ path: `${shots}/hero-card-lv2-depth.png` });
  assert.equal(live2dRequests.filter((path) => path === "/live2d/whale-maid/c_0120.model3.json").length, modelLoadCount);
  assert.equal(await page.locator(".card-preview__hero-model canvas").count(), 1);

  await page.getByRole("button", { name: "预览等级 3：默契" }).click();
  assert.equal(await page.locator(".card-preview__hero").getAttribute("data-level"), "3");
  assert.equal(await page.locator(".card-preview__hero-light").evaluate((el) => getComputedStyle(el).animationName), "hero-light");
  await page.locator(".card-preview__hero").hover({ position: { x: 42, y: 128 } });
  await page.waitForTimeout(250);
  await page.locator(".card-preview__hero").screenshot({ path: `${shots}/hero-card-lv3-dynamic.png` });
  await page.getByRole("button", { name: "预览等级 4：亲近" }).click();
  assert.equal(await page.locator(".card-preview__hero").getAttribute("data-level"), "4");
  assert.equal(await page.locator(".card-preview__particles span").count(), 9);
  await page.locator(".card-preview__hero").hover({ position: { x: 42, y: 128 } });
  await page.waitForTimeout(250);
  await page.locator(".card-preview__hero").screenshot({ path: `${shots}/hero-card-lv4-exclusive.png` });
  assert.equal(await page.locator(".card-preview__hero").getAttribute("data-level"), "4");
  assert.equal(live2dRequests.filter((path) => path === "/live2d/whale-maid/c_0120.model3.json").length, modelLoadCount);

  const claudeCard = page.getByRole("button", { name: /选择小克/ });
  await claudeCard.focus();
  await page.keyboard.press("Enter");
  assert.equal(await claudeCard.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".card-preview__hero-model").count(), 0);
  assert.equal(await page.getByText(/不借用其他角色的模型/).count(), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.character")), "claude");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const animationNames = await page.locator(".card-preview__hero-sheen, .card-preview__hero-light, .card-preview__hero-orbit, .card-preview__particles span").evaluateAll((elements) => elements.map((el) => getComputedStyle(el).animationName));
  assert.ok(animationNames.length >= 4);
  assert.deepEqual([...new Set(animationNames)], ["none"]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  const mobileErrors = [];
  const mobileApiRequests = [];
  mobile.on("pageerror", (error) => mobileErrors.push(error.message));
  mobile.on("console", (message) => {
    if (message.type() === "error") mobileErrors.push(`${message.text()} ${JSON.stringify(message.location())}`);
  });
  mobile.on("requestfailed", (request) => mobileErrors.push(`${request.failure()?.errorText} ${request.url()}`));
  mobile.on("response", (response) => {
    if (response.status() >= 400) mobileErrors.push(`${response.status()} ${response.url()}`);
  });
  mobile.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) mobileApiRequests.push(request.url());
  });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.evaluate(() => document.fonts.ready);
  await mobile.locator(".card-preview__hero-model .live2d[data-stage='ready']").waitFor({ state: "visible", timeout: 30000 });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `mobile horizontal overflow: ${overflow}px`);
  await mobile.screenshot({ path: `${shots}/mobile-overview-390x844.png` });
  await mobile.getByRole("button", { name: "预览等级 2：相熟" }).tap();
  assert.equal(await mobile.locator(".card-preview__hero").getAttribute("data-level"), "2");
  await mobile.getByRole("button", { name: /选择小智/ }).tap();
  assert.equal(await mobile.getByRole("button", { name: /选择小智/ }).getAttribute("aria-pressed"), "true");
  await mobile.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    (document.activeElement instanceof HTMLElement ? document.activeElement : null)?.blur();
  });
  await mobile.mouse.move(0, 0);
  await mobile.screenshot({ path: `${shots}/mobile-390x844.png`, fullPage: true });
  assert.deepEqual(mobileApiRequests, []);
  assert.deepEqual(mobileErrors, []);
  await mobileContext.close();

  const appContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const appPage = await appContext.newPage();
  const appErrors = [];
  appPage.on("pageerror", (error) => appErrors.push(error.message));
  const relationshipRequests = [];
  const relationshipAttempts = new Map();
  await appPage.route("**/api/relationship?character=**", async (route) => {
    const character = new URL(route.request().url()).searchParams.get("character") ?? "deepseek";
    relationshipRequests.push(character);
    const attempts = (relationshipAttempts.get(character) ?? 0) + 1;
    relationshipAttempts.set(character, attempts);
    if (character === "whale" && attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
      return;
    }
    const points = character === "deepseek" ? 128 : character === "claude" ? 32 : 0;
    const stage = points >= 250 ? 4 : points >= 100 ? 3 : points >= 25 ? 2 : 1;
    const stages = [
      { label: "相识", effect: "基础卡面", nextThreshold: 25 },
      { label: "相熟", effect: "立体效果", nextThreshold: 100 },
      { label: "默契", effect: "动态画面", nextThreshold: 250 },
      { label: "亲近", effect: "专属特效", nextThreshold: null },
    ];
    const current = stages[stage - 1];
    const previous = [0, 25, 100, 250][stage - 1];
    const progress = current.nextThreshold === null ? 100 : Math.round(((points - previous) / (current.nextThreshold - previous)) * 100);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ points, level: stage, ...current, progress, mood: { emotion: "neutral", intensity: 0, updatedAt: null } }),
    });
  });
  await appPage.addInitScript(() => {
    localStorage.setItem("wp.onboarded", "1");
    localStorage.setItem("wp.character", "deepseek");
  });
  await appPage.goto(new URL("/settings", base).toString(), { waitUntil: "domcontentloaded" });
  await appPage.getByRole("button", { name: "换一位" }).click();
  const characterDialog = appPage.getByRole("dialog", { name: "换一位" });
  await characterDialog.locator(".card-preview__hero-model .live2d[data-stage='ready']").waitFor({ state: "visible", timeout: 30000 });
  const appCard = characterDialog.locator(".card-preview__hero");
  await characterDialog.locator(".card-preview__live-progress").waitFor({ state: "visible" });
  assert.equal(await appCard.getAttribute("data-character"), "deepseek");
  assert.equal(await appCard.getAttribute("data-level"), "3");
  assert.equal(await characterDialog.locator(".card-preview__hero-top, .card-preview__hero-copy, .card-preview__hero-art-caption").count(), 0);
  assert.match(await characterDialog.locator(".card-preview__live-progress").innerText(), /128 点/);
  assert.match(await characterDialog.locator(".card-preview__live-progress .card-preview__tier-next").innerText(), /还需 122 点/);
  assert.equal(await characterDialog.locator(".card-preview__live-progress [role='progressbar']").getAttribute("aria-valuenow"), "19");
  await appPage.screenshot({ path: `${shots}/role-card-dialog-1440x960.png` });
  await characterDialog.getByRole("button", { name: /小克/ }).click();
  await appCard.waitFor({ state: "visible" });
  await appCard.evaluate((el) => el.getAttribute("data-character") === "claude" || new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (el.getAttribute("data-character") === "claude") {
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-character"] });
  }));
  await characterDialog.locator(".card-preview__live-progress").waitFor({ state: "visible" });
  assert.equal(await appCard.getAttribute("data-level"), "2");
  assert.equal(await appPage.evaluate(() => localStorage.getItem("wp.character")), "claude");
  assert.equal(await characterDialog.locator(".card-preview__hero-model").count(), 0);
  await characterDialog.getByRole("button", { name: /鲸汐/ }).click();
  await characterDialog.getByRole("button", { name: "重试读取好感度" }).waitFor({ state: "visible" });
  assert.equal(await appCard.getAttribute("data-level"), "1");
  await characterDialog.getByRole("button", { name: "重试读取好感度" }).click();
  await characterDialog.locator(".card-preview__live-progress").waitFor({ state: "visible" });
  assert.deepEqual(relationshipRequests, ["deepseek", "claude", "whale", "whale"]);
  await characterDialog.getByRole("button", { name: "好" }).click();
  assert.equal(await appPage.locator(".set-her__name").innerText(), "鲸汐");
  await appPage.setViewportSize({ width: 390, height: 844 });
  await appPage.getByRole("button", { name: "换一位" }).click();
  const mobileDialog = appPage.getByRole("dialog", { name: "换一位" });
  await mobileDialog.locator(".card-preview__hero").waitFor({ state: "visible" });
  const appOverflow = await appPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(appOverflow <= 0, `role selector horizontal overflow: ${appOverflow}px`);
  assert.deepEqual(appErrors, []);
  await appContext.close();
  console.log(`角色闪卡检查通过；截图保存至 ${shots}`);
} finally {
  await browser.close();
}
