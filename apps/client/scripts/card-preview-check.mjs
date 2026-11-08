import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.WP_CARD_PREVIEW_URL ?? "http://127.0.0.1:1420/character-cards.html";
const shots = fileURLToPath(new URL("../../../docs/redesign/shots/character-cards/", import.meta.url));
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
  await page.addInitScript(() => {
    localStorage.setItem("wp.character", "claude");
    const drawArrays = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      const result = drawArrays.apply(this, args);
      if (this.canvas.classList.contains("card-preview__foil-shader")) {
        const pixel = new Uint8Array(4);
        this.readPixels(Math.floor(this.drawingBufferWidth / 2), Math.floor(this.drawingBufferHeight / 2), 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
        window.__foilPixel = Array.from(pixel);
      }
      return result;
    };
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  assert.equal(await page.getByRole("heading", { name: "角色闪卡" }).count(), 1);
  assert.equal(await page.locator(".card-preview__card").count(), 4);
  assert.equal(await page.getByRole("button", { name: /预览等级/ }).count(), 5);
  assert.match(await page.locator("body").innerText(), /固定演示值，不代表真实账号/);
  assert.equal(await page.locator(".card-preview__hero").getAttribute("data-level"), "5");
  await page.locator(".card-preview__hero-model .live2d[data-stage='ready']").waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await page.locator(".card-preview__hero-model canvas").count(), 1);
  const modelHeightRatio = await page.locator(".card-preview__hero-model .live2d").evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--stage-char-h")));
  const modelWidthRatio = await page.locator(".card-preview__hero-model .live2d").evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--stage-char-w")));
  assert.ok(modelHeightRatio >= 1.05, `card model height ratio is too small: ${modelHeightRatio}`);
  assert.ok(modelWidthRatio >= 1, `card model width ratio is too small: ${modelWidthRatio}`);
  await page.locator(".card-preview__foil-shader[data-shader-state='ready']").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".card-preview__foil-shader").count(), 1);
  assert.ok(live2dRequests.includes("/live2d/whale-maid/c_0120.model3.json"));
  assert.ok(live2dRequests.includes("/live2d/libs/live2dcubismcore.min.js"));
  assert.match(await page.locator(".card-preview__model-status").innerText(), /Live2D 已载入/);
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.character")), "claude");
  await page.waitForTimeout(100);
  const restingFoilPixel = await page.evaluate(() => window.__foilPixel);
  assert.ok(Array.isArray(restingFoilPixel) && restingFoilPixel[3] > 20, `resting foil is too transparent: ${restingFoilPixel}`);

  const initialFontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.evaluate(() => document.documentElement.style.setProperty("--scale", "1.25"));
  const scaledFontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  assert.ok(scaledFontSize > initialFontSize);
  await page.evaluate(() => document.documentElement.style.removeProperty("--scale"));

  await page.locator(".card-preview__hero").hover({ position: { x: 42, y: 128 } });
  await page.waitForTimeout(250);
  const tiltedFoilPixel = await page.evaluate(() => window.__foilPixel);
  assert.ok(Array.isArray(tiltedFoilPixel) && tiltedFoilPixel[3] > 20, `tilted foil is too transparent: ${tiltedFoilPixel}`);
  const hueShift = restingFoilPixel.slice(0, 3).reduce((shift, channel, index) => shift + Math.abs(channel - tiltedFoilPixel[index]), 0);
  assert.ok(hueShift > 50, `foil color did not respond to angle: ${restingFoilPixel} -> ${tiltedFoilPixel}`);
  await page.screenshot({ path: `${shots}/desktop-foil-1440x960.png`, fullPage: true });
  await page.locator(".card-preview__hero").screenshot({ path: `${shots}/hero-card-foil.png` });

  const modelLoadCount = live2dRequests.filter((path) => path === "/live2d/whale-maid/c_0120.model3.json").length;
  await page.getByRole("button", { name: "预览等级 1：初识" }).click();
  assert.equal(await page.locator(".card-preview__hero").getAttribute("data-level"), "1");
  assert.equal(await page.locator(".card-preview__particles").count(), 0);
  assert.equal(await page.locator(".card-preview__foil-shader").count(), 0);
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
  await page.getByRole("button", { name: "预览等级 5：相依" }).click();
  assert.equal(await page.locator(".card-preview__foil-shader").getAttribute("data-shader-state"), "ready");
  assert.equal(live2dRequests.filter((path) => path === "/live2d/whale-maid/c_0120.model3.json").length, modelLoadCount);

  const claudeCard = page.getByRole("button", { name: /选择小克/ });
  await claudeCard.focus();
  await page.keyboard.press("Enter");
  assert.equal(await claudeCard.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".card-preview__hero-model").count(), 0);
  assert.equal(await page.getByText(/不借用其他角色的模型/).count(), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.character")), "claude");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const animationNames = await page.locator(".card-preview__card[data-foil='true'] .card-preview__shine, .card-preview__hero-holo, .card-preview__hero-sheen, .card-preview__hero-light, .card-preview__particles span").evaluateAll((elements) => elements.map((el) => getComputedStyle(el).animationName));
  assert.ok(animationNames.length >= 4);
  assert.deepEqual([...new Set(animationNames)], ["none"]);
  assert.equal(await page.locator(".card-preview__foil-shader").evaluate((el) => getComputedStyle(el).opacity), "0.74");
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
  console.log(`角色闪卡检查通过；截图保存至 ${shots}`);
} finally {
  await browser.close();
}
