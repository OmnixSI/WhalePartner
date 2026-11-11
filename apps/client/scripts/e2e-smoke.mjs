// 端到端冒烟：四个页面 + 关键交互。对着 `vite preview` + 本机 API 跑。
// 用法：node scripts/e2e-smoke.mjs [baseUrl] [--chat] [--packaged]
//   --chat      真的发一条消息（会花一次模型调用）
//   --packaged  只用 dist 静态文件 + 在页面里假装 `__TAURI_INTERNALS__`，
//               于是 fetch 直连 http://127.0.0.1:8787，**真的走跨源预检**。
//               0.2.3 的 `Load failed` 只在桌面壳里出现，开发环境复现不了，所以要有这一档。
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { launchChrome } from "./browser.mjs";

const packaged = process.argv.includes("--packaged");
const withChat = process.argv.includes("--chat");
const fails = [];
const notes = [];

/** 桌面档：把 dist 挂在 127.0.0.1:1420（本机 API 的放行来源之一），和 Tauri 壳同构。 */
let staticServer = null;
if (packaged) {
  const root = new URL("../dist/", import.meta.url).pathname;
  if (!existsSync(root)) {
    console.error("没有 dist，先跑 pnpm build");
    process.exit(1);
  }
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".moc3": "application/octet-stream",
  };
  staticServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1:1420");
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(root, "index.html");
    const body = await readFile(file).catch(() => null);
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(body);
  });
  await new Promise((resolve) => staticServer.listen(1420, "127.0.0.1", resolve));
}

const base = process.argv.find((a) => a.startsWith("http")) ?? (packaged ? "http://127.0.0.1:1420" : "http://127.0.0.1:4282");

function ok(name, cond, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { console.log(`✗ ${name} ${detail}`); fails.push(name); }
}

const browser = await launchChrome(chromium);

async function open(path, viewport = { width: 1180, height: 752 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.addInitScript((isPackaged) => {
    localStorage.setItem("wp.onboarded", "1");
    // 桌面壳里页面来自 tauri://，`lib/api.ts` 靠这个标记切到绝对地址 → 跨源 → 真的走预检。
    if (isPackaged) window.__TAURI_INTERNALS__ = {};
  }, packaged);
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  return { page, errors };
}

/* 1. 聊天页 */
{
  const { page, errors } = await open("/");
  const canvas = await page.locator(".scene__figure canvas").count();
  ok("聊天页：舞台有画布", canvas > 0, `canvas=${canvas}`);
  ok("聊天页：输入条存在", await page.locator(".composer textarea, textarea").count() > 0);
  ok("聊天页：无 JS 报错", errors.filter((e) => !e.includes("502")).length === 0, errors.slice(0, 2).join(" | "));

  if (withChat) {
    const input = page.locator("textarea").first();
    await input.fill("你还记得我最喜欢什么吗？");
    await input.press("Meta+Enter").catch(async () => { await page.getByRole("button", { name: /发送/ }).click(); });
    await page.waitForTimeout(12000);
    const her = await page.locator(".dlg__text, .dlg").first().innerText().catch(() => "");
    ok("聊天页：收到她的回复", her.trim().length > 0, `回复前 40 字：${her.slice(0, 40)}`);
    notes.push(`回复片段：${her.replace(/\s+/g, " ").slice(0, 80)}`);
  }
  await page.screenshot({ path: "/tmp/e2e-chat.png" });
  await page.close();
}

/* 2. 日记页 */
{
  const { page, errors } = await open("/diary");
  const text = await page.locator("body").innerText();
  ok("日记页：渲染出内容", text.includes("日记") || text.includes("她今天"));
  ok("日记页：无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.screenshot({ path: "/tmp/e2e-diary.png" });
  await page.close();
}

/* 3. 记忆页 */
{
  const { page, errors } = await open("/memory");
  const text = await page.locator("body").innerText();
  ok("记忆页：渲染出内容", text.includes("记得") || text.includes("她记得"));
  ok("记忆页：无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.screenshot({ path: "/tmp/e2e-memory.png" });
  await page.close();
}

/* 4. 设置页：模型接入 + 逛的设置可点 */
{
  const { page, errors } = await open("/settings");
  ok("设置页：模型接入组存在", (await page.locator("#model").count()) === 1);
  const ds = await page.locator("#model").innerText().catch(() => "");
  ok("设置页：DeepSeek 状态可见", /已配置|未配置/.test(ds), ds.slice(0, 40).replace(/\n+/g, " "));

  const row = page.locator(".set-row[data-tap='on']").first();
  if (await row.count()) {
    const sw = page.getByRole("switch").first();
    const before = await sw.getAttribute("aria-checked");
    await row.locator(".set-row__title").click().catch(() => {});
    await page.waitForTimeout(1200);
    const after = await sw.getAttribute("aria-checked");
    ok("设置页：点整行能切换开关", before !== after, `${before} -> ${after}`);
    ok("设置页：出现保存回执", (await page.locator(".set-receipt").count()) > 0);
  } else {
    ok("设置页：逛的设置可点行存在", false);
  }
  ok("设置页：无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.screenshot({ path: "/tmp/e2e-settings.png" });
  await page.close();
}

/* 5. 手机尺寸：无横向滚动 */
for (const [path, name] of [["/", "聊天"], ["/settings", "设置"], ["/memory", "记忆"]]) {
  const { page } = await open(path, { width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`手机 ${name}：无横向滚动`, overflow <= 0, `溢出 ${overflow}px`);
  await page.close();
}

/* 6. 桌面档：写操作必须真的写进去（PUT 走预检），页面上不许出现英文 Load failed */
if (packaged) {
  // 先看聊天页：情绪不能漏成正文，名字牌上的点要有颜色
  {
    const { page } = await open("/");
    const chatText = await page.locator("body").innerText();
    ok("桌面档：字幕里没有 [emotion:xxx] 标签", !/\[\s*emotion\s*:/i.test(chatText), chatText.slice(0, 120).replace(/\n+/g, " "));
    const dot = await page.locator(".nametab__dot").first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
    ok("桌面档：名字牌情绪点有颜色", /rgb/.test(dot), dot);
    await page.close();
  }
  const { page, errors } = await open("/settings");
  const text = await page.locator("body").innerText();
  ok("桌面档：页面里没有英文 Load failed", !/load failed|failed to fetch/i.test(text), text.slice(0, 80).replace(/\n+/g, " "));

  // 逛设置：点开关 → 等落盘 → 重载后还是新状态
  const sw = page.getByRole("switch").first();
  const before = await sw.getAttribute("aria-checked");
  await sw.click();
  await page.waitForTimeout(1500);
  const after = await sw.getAttribute("aria-checked");
  ok("桌面档：开关点了不弹回去", before !== after, `${before} -> ${after}`);
  ok("桌面档：出现「已保存」回执", /已保存/.test(await page.locator(".set-receipt").first().innerText().catch(() => "")));
  ok("桌面档：没有报错行", (await page.locator(".set-fail").count()) === 0, await page.locator(".set-fail").first().innerText().catch(() => ""));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  ok("桌面档：重载后开关保持新状态", (await page.getByRole("switch").first().getAttribute("aria-checked")) === after);

  // 昵称：存一个 → 重载后还在（字段名对不上就会在这里露馅）
  const name = `小鲸${Date.now() % 1000}`;
  const field = page.locator(".set-nick__field");
  await field.fill(name);
  await page.locator(".set-nick__save").click();
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  ok("桌面档：昵称存得住（重载后回显）", (await page.locator(".set-nick__field").inputValue().catch(() => "")) === name, `期望 ${name}`);
  ok("桌面档：无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

await browser.close();
if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
console.log(`\n${fails.length === 0 ? "全部通过" : `失败 ${fails.length} 项：${fails.join("、")}`}`);
if (notes.length) console.log(notes.join("\n"));
process.exit(fails.length === 0 ? 0 : 1);
