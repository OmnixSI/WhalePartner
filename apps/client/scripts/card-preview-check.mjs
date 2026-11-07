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
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} ${JSON.stringify(message.location())}`);
  });
  page.on("requestfailed", (request) => errors.push(`${request.failure()?.errorText} ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem("wp.character", "claude"));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  assert.equal(await page.getByRole("heading", { name: "角色闪卡" }).count(), 1);
  assert.equal(await page.locator(".card-preview__card").count(), 4);
  assert.match(await page.locator("body").innerText(), /固定演示值，不代表真实账号/);
  assert.equal(await page.getByRole("button", { name: /细闪未解锁/ }).isDisabled(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.character")), "claude");

  const initialFontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.evaluate(() => document.documentElement.style.setProperty("--scale", "1.25"));
  const scaledFontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  assert.ok(scaledFontSize > initialFontSize);
  await page.evaluate(() => document.documentElement.style.removeProperty("--scale"));

  const claudeCard = page.getByRole("button", { name: /选择小克/ });
  await claudeCard.focus();
  await page.keyboard.press("Enter");
  assert.equal(await claudeCard.getAttribute("aria-pressed"), "true");
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.character")), "claude");
  await page.screenshot({ path: `${shots}/desktop-locked-1440x960.png`, fullPage: true });

  await page.getByRole("button", { name: "默契" }).click();
  const effectButton = page.getByRole("button", { name: "预览细闪" });
  assert.equal(await effectButton.isDisabled(), false);
  await effectButton.click();
  assert.equal(await claudeCard.getAttribute("data-foil"), "true");
  await page.screenshot({ path: `${shots}/desktop-foil-1440x960.png`, fullPage: true });

  await page.emulateMedia({ reducedMotion: "reduce" });
  const animationName = await page.locator("[data-foil='true'] .card-preview__shine").evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(animationName, "none");
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
    if (new URL(request.url()).pathname.startsWith("/api/")) mobileApiRequests.push(request.url());
  });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.evaluate(() => document.fonts.ready);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `mobile horizontal overflow: ${overflow}px`);
  await mobile.screenshot({ path: `${shots}/mobile-overview-390x844.png` });
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
