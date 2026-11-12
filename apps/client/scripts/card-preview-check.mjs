import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { launchChrome } from "./browser.mjs";

const base = process.env.WP_CARD_PREVIEW_URL ?? "http://127.0.0.1:1420/character-cards.html";
const shots = fileURLToPath(new URL("../test-results/card-preview/", import.meta.url));
const browser = await launchChrome(chromium);

const TIERS = [
  { level: 1, label: "相识", finish: "素纸" },
  { level: 2, label: "相熟", finish: "银衬" },
  { level: 3, label: "默契", finish: "潮光" },
  { level: 4, label: "亲近", finish: "金缘" },
  { level: 5, label: "相依", finish: "镀闪" },
];
const CHARACTERS = [
  { id: "whale", name: "鲸汐" },
  { id: "deepseek", name: "大肥鱼" },
  { id: "claude", name: "小克" },
  { id: "chatgpt", name: "小智" },
];
const UPGRADES = [
  { from: 1, to: 2, fromLabel: "相识", toLabel: "相熟" },
  { from: 2, to: 3, fromLabel: "相熟", toLabel: "默契" },
  { from: 3, to: 4, fromLabel: "默契", toLabel: "亲近" },
  { from: 4, to: 5, fromLabel: "亲近", toLabel: "相依" },
];
const STAGE = '[data-testid="card-stage"] .acard';

const collectErrors = (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} ${JSON.stringify(message.location())}`);
  });
  page.on("requestfailed", (request) => errors.push(`${request.failure()?.errorText} ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
};

async function assertTierRow(page) {
  const cards = page.getByTestId("card-tiers").locator(".acard");
  assert.equal(await cards.count(), 5);
  const labels = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") ?? ""));
  for (const [index, tier] of TIERS.entries()) {
    assert.equal(await cards.nth(index).getAttribute("data-level"), String(tier.level));
    assert.match(labels[index], new RegExp(`Lv\\.${tier.level} ${tier.label}`));
    assert.match(labels[index], new RegExp(`${tier.finish}卡面`));
  }
  const text = await page.getByTestId("card-tiers").innerText();
  const order = ["相识", "相熟", "默契", "亲近", "相依"].map((label) => text.indexOf(label));
  assert.ok(order.every((index) => index >= 0), `五档文案不齐：${text}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `五档顺序不对：${text}`);
}

async function waitForUpgrade(page, to) {
  await page.waitForFunction(
    ({ selector, level }) => document.querySelector(selector)?.getAttribute("data-upgrading") === String(level),
    { selector: STAGE, level: to },
  );
}

async function waitForIdle(page) {
  await page.waitForFunction(
    (selector) => !document.querySelector(selector)?.hasAttribute("data-upgrading"),
    STAGE,
    { timeout: 6000 },
  );
}

try {
  await mkdir(shots, { recursive: true });

  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  const apiRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem("wp.character", "claude");
    localStorage.setItem("wp.theme", "light");
    localStorage.setItem("wp.motion", "full");
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  assert.equal(await page.getByRole("heading", { name: "角色闪卡" }).count(), 1);
  assert.match(await page.locator("body").innerText(), /固定演示值|固定演示数据/);
  await assertTierRow(page);

  const characterButtons = page.getByRole("button", { name: /^选择/ });
  assert.equal(await characterButtons.count(), 4);
  for (const [index, character] of CHARACTERS.entries()) {
    assert.equal(await characterButtons.nth(index).getAttribute("aria-label"), `选择${character.name}`);
  }

  for (const character of CHARACTERS) {
    await page.getByRole("button", { name: `选择${character.name}` }).click();
    const shown = await page.getByTestId("card-tiers").locator(".acard").evaluateAll(
      (elements) => [...new Set(elements.map((element) => element.getAttribute("data-character")))],
    );
    assert.deepEqual(shown, [character.id], `切换 ${character.name} 后卡面角色不对：${shown.join(",")}`);
  }

  const gallery = page.getByTestId("card-characters").locator(".acard");
  assert.equal(await gallery.count(), 4);
  assert.deepEqual(
    await gallery.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-character"))),
    CHARACTERS.map((character) => character.id),
  );
  assert.deepEqual(
    await gallery.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-level"))),
    ["5", "5", "5", "5"],
  );

  assert.equal(await page.locator(STAGE).getAttribute("data-level"), "2");
  assert.equal(await page.locator(STAGE).getAttribute("data-upgrading"), null);

  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "light");
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.theme")), "light");
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.screenshot({ path: `${shots}/desktop-light-1440x960.png` });
  await page.getByTestId("card-tiers").screenshot({ path: `${shots}/tiers-light.png` });

  await page.getByRole("button", { name: "暗色" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark");
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme-pref")), "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.theme")), "light", "预览页切暗色不应写 wp.theme");
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(darkBackground, lightBackground, "亮色与暗色的页面底色相同");
  await page.screenshot({ path: `${shots}/desktop-dark-1440x960.png` });
  await page.getByTestId("card-tiers").screenshot({ path: `${shots}/tiers-dark.png` });
  await page.getByRole("button", { name: "亮色" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "light");
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.theme")), "light");

  let expectedEnds = 0;
  for (const upgrade of UPGRADES) {
    await page.getByRole("button", {
      name: `预览升级 ${upgrade.from}→${upgrade.to}：${upgrade.fromLabel}到${upgrade.toLabel}`,
    }).click();
    await waitForUpgrade(page, upgrade.to);
    assert.equal(await page.locator(STAGE).getAttribute("data-level"), String(upgrade.to));
    await page.locator(`${STAGE} .acard__skip`).click();
    await waitForIdle(page);
    expectedEnds += 1;
    assert.equal(await page.locator(STAGE).getAttribute("data-level"), String(upgrade.to));
    assert.equal(await page.locator("#card-upgrade-status").getAttribute("data-ends"), String(expectedEnds));
    assert.match(await page.locator("#card-upgrade-status").innerText(), new RegExp(`${upgrade.from}→${upgrade.to} 已跳过`));
    await page.locator(STAGE).screenshot({ path: `${shots}/upgrade-${upgrade.from}${upgrade.to}.png` });
  }

  await page.getByRole("button", { name: "预览升级 4→5：亲近到相依" }).click();
  await waitForUpgrade(page, 5);
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.querySelector(".acard__notice")?.textContent?.includes("升到 Lv.5"),
    STAGE,
  );
  await waitForIdle(page);
  expectedEnds += 1;
  assert.equal(await page.locator("#card-upgrade-status").getAttribute("data-ends"), String(expectedEnds));
  assert.match(await page.locator("#card-upgrade-status").innerText(), /4→5 播完/);

  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  const runningAnimations = await page.evaluate(() => {
    const running = [];
    for (const element of document.querySelectorAll(".card-preview-page *")) {
      const style = getComputedStyle(element);
      if (style.animationName !== "none" && style.animationPlayState === "running") {
        running.push(`${element.className}: ${style.animationName}`);
      }
    }
    return running;
  });
  assert.deepEqual(runningAnimations, [], `静置时仍有循环动画：${runningAnimations.join("；")}`);

  await page.getByTestId("card-characters").screenshot({ path: `${shots}/characters-light.png` });
  assert.equal(await page.evaluate(() => localStorage.getItem("wp.character")), "claude");
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  await context.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  const mobileErrors = collectErrors(mobile);
  const mobileApiRequests = [];
  mobile.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) mobileApiRequests.push(request.url());
  });
  await mobile.addInitScript(() => {
    localStorage.setItem("wp.character", "claude");
    localStorage.setItem("wp.theme", "light");
    localStorage.setItem("wp.motion", "full");
  });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.evaluate(() => document.fonts.ready);
  await assertTierRow(mobile);
  assert.equal(await mobile.getByTestId("card-characters").locator(".acard").count(), 4);

  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `手机横向溢出：${overflow}px`);
  await mobile.getByRole("button", { name: "选择小智" }).tap();
  assert.deepEqual(
    await mobile.getByTestId("card-tiers").locator(".acard").evaluateAll(
      (elements) => [...new Set(elements.map((element) => element.getAttribute("data-character")))],
    ),
    ["chatgpt"],
  );
  await mobile.screenshot({ path: `${shots}/mobile-light-390x844.png` });
  await mobile.getByTestId("card-tiers").screenshot({ path: `${shots}/mobile-tiers-390x844.png` });
  await mobile.getByRole("button", { name: "暗色" }).tap();
  assert.equal(await mobile.evaluate(() => document.documentElement.getAttribute("data-theme")), "dark");
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(mobileOverflow <= 0, `手机暗色横向溢出：${mobileOverflow}px`);
  await mobile.screenshot({ path: `${shots}/mobile-dark-390x844.png` });
  assert.deepEqual(mobileApiRequests, []);
  assert.deepEqual(mobileErrors, []);
  await mobileContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    reducedMotion: "reduce",
  });
  const reduced = await reducedContext.newPage();
  const reducedErrors = collectErrors(reduced);
  await reduced.addInitScript(() => {
    localStorage.setItem("wp.theme", "light");
    localStorage.setItem("wp.motion", "full");
  });
  await reduced.goto(base, { waitUntil: "networkidle" });
  await reduced.evaluate(() => document.fonts.ready);
  await reduced.getByRole("button", { name: "预览升级 1→2：相识到相熟" }).click();
  await waitForUpgrade(reduced, 2);
  assert.equal(await reduced.locator(STAGE).getAttribute("data-calm"), "true");
  assert.match(await reduced.locator(`${STAGE} .acard__notice`).innerText(), /升到 Lv\.2/);
  await waitForIdle(reduced);
  assert.match(await reduced.locator("#card-upgrade-status").innerText(), /1→2 播完/);
  assert.deepEqual(reducedErrors, []);
  await reducedContext.close();

  console.log(`角色闪卡五档检查通过；截图保存至 ${shots}`);
} finally {
  await browser.close();
}
