// 端到端冒烟：四个页面 + 关键交互。对着 `vite preview` + 本机 API 跑。
// 用法：node scripts/redesign/e2e-smoke.mjs [baseUrl] [--chat]
//   --chat 会真的发一条消息（会花一次模型调用）
import { chromium } from "playwright";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:4282";
const withChat = process.argv.includes("--chat");
const fails = [];
const notes = [];

function ok(name, cond, detail = "") {
  if (cond) console.log(`✓ ${name}`);
  else { console.log(`✗ ${name} ${detail}`); fails.push(name); }
}

const browser = await chromium.launch();

async function open(path, viewport = { width: 1180, height: 752 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.addInitScript(() => localStorage.setItem("wp.onboarded", "1"));
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

await browser.close();
console.log(`\n${fails.length === 0 ? "全部通过" : `失败 ${fails.length} 项：${fails.join("、")}`}`);
if (notes.length) console.log(notes.join("\n"));
process.exit(fails.length === 0 ? 0 : 1);
