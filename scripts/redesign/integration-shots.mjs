#!/usr/bin/env node
/**
 * 集成截图：真后端（假上游模型）+ 后端静态托管的 client/dist，用 Playwright + 本机 Chrome 截图，
 * 并模拟两台设备验证「A 发消息，B 实时出现」。
 *
 *   node scripts/redesign/integration-shots.mjs [--out=docs/redesign/shots/integration] [--sizes=1180x780,1920x1080]
 *   WP_CHROME=/usr/bin/google-chrome     浏览器路径（缺省 google-chrome）
 *
 * 需要 Node 26（直接 import apps/api 的 .ts 种子数据）、已 `pnpm --dir apps/client run build`。
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = join(ROOT, arg("out", "docs/redesign/shots/integration"));
const SIZES = arg("sizes", "1180x780,1920x1080").split(",").map((s) => s.split("x").map(Number));
const API_PORT = Number(arg("port", "8799"));
const LLM_PORT = 9911;
const TOKEN = "home-secret";
const BASE = `http://127.0.0.1:${API_PORT}`;
const require = createRequire(join(ROOT, "apps/client/package.json"));
const { chromium } = require("playwright");

mkdirSync(OUT, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "wp-int-"));
const log = (...a) => console.log("[int]", ...a);

// ---- 假上游模型：OpenAI 兼容的流式接口，固定回一句话 ----
const REPLY = "[emotion:happy] 你回来啦。今天海面很平，我把捡到的小石头放在你手边了。";
const llm = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "stub" }] }));
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chars = [...REPLY];
    let i = 0;
    const tick = () => {
      if (i >= chars.length) {
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: chars.length } })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      const piece = chars.slice(i, i + 3).join("");
      i += 3;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      setTimeout(tick, 60);
    };
    tick();
  });
});
await new Promise((resolve) => llm.listen(LLM_PORT, "127.0.0.1", resolve));

// ---- 种子：见闻（直接写库，后端起来前） ----
const { SurfRepository } = await import(join(ROOT, "apps/api/src/surf/store.ts"));
const surfDir = join(dataDir, "surf");
mkdirSync(surfDir, { recursive: true });
const store = new SurfRepository(join(dataDir, "app.db"));
const now = new Date();
const iso = (hoursAgo) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
const { session } = store.startSession("whale", `seed-${Date.now()}`, iso(5));
const seeds = [
  ["web", "鲸歌是怎么传遍整片海的", "https://example.org/whale-song", "example.org", "座头鲸的歌会在种群之间接力，几年就能换一整套曲调。", "原来它们也会流行新歌。", ["鲸", "声音"], "#6d8fc7", 1],
  ["video", "灯塔守夜人的一天", "https://www.bilibili.com/video/BV1yy411c7mE", "bilibili.com", "守夜人一天只做三件事：擦灯、看海、记天气。", "安静不是没有声音，是知道声音从哪来。", ["灯塔"], "#c79a6d", 3],
  ["web", "把碎玻璃磨成海玻璃", "https://example.org/sea-glass", "example.org", "海浪和时间把锋利的边磨成了圆的。", "有些事只是需要时间。", ["海边", "手作"], "#7fb0a0", 26],
  ["web", "潮汐表怎么读", "https://example.net/tides", "example.net", "高潮、低潮和小潮之间，其实差着半个月的节奏。", "以后看海之前先看一眼潮汐表。", ["潮汐"], "#b58fb5", 30],
];
seeds.forEach(([kind, title, url, site, summary, comment, tags, color, hours], index) => {
  const file = `seed-${index}.png`;
  execFileSync("convert", ["-size", "640x360", `xc:${color}`, "-fill", "#ffffff55", "-draw", "circle 320,180 320,260", join(surfDir, file)]);
  store.insertItem({ character: "whale", sessionId: session.id, kind, title, url, sourceSite: site, summary, comment, tags, score: 0.8, dedupeKey: `seed:${index}`, createdAt: iso(hours), thumbPath: file });
});
store.finishSession(session.id, "done", seeds.length, null, iso(4));
store.close?.();

// ---- 起后端 ----
const api = spawn(process.execPath, ["src/server.ts"], {
  cwd: join(ROOT, "apps/api"),
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    WP_DATA_DIR: dataDir,
    WP_LOCAL_TOKEN: TOKEN,
    WP_STATIC_DIR: join(ROOT, "apps/client/dist"),
    DEEPSEEK_API_KEY: "stub-key",
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${LLM_PORT}`,
    CODEX_FALLBACK: "0",
    MEMORY: "off",
    SURF_ENABLED: "0",
    WP_EVENTS_HEARTBEAT_MS: "3000",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
api.stdout.on("data", (d) => process.stdout.write(`[api] ${d}`));
api.stderr.on("data", (d) => process.stderr.write(`[api!] ${d}`));
const call = (path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) } });
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* 还没起来 */ }
  await new Promise((r) => setTimeout(r, 500));
}

const cleanup = async () => {
  api.kill("SIGTERM");
  llm.close();
};
process.on("exit", () => api.kill("SIGKILL"));

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

try {
  // 种子：记忆、昵称
  await call("/api/profile", { method: "PUT", body: JSON.stringify({ userName: "阿潮" }) });
  const memories = [
    ["experience", "海边捡到的第一块玻璃", "你听了很久，说它像被时间磨过的糖。", null],
    ["experience", "灯塔守夜人的一天", "守夜人一天只做三件事：擦灯、看海、记天气。", "https://www.bilibili.com/video/BV1yy411c7mE"],
  ];
  for (const [kind, title, text, url] of memories) {
    await call("/api/memories/experience", { method: "POST", body: JSON.stringify({ kind, title, text, ...(url ? { url } : {}) }) });
  }

  const browser = await chromium.launch({ executablePath: process.env.WP_CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const newDevice = async (size, { paired = false } = {}) => {
    const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, locale: "zh-CN" });
    await context.addInitScript(({ token, doneOnboarding, paired: isPaired }) => {
      try {
        if (!isPaired) localStorage.setItem("wp.hub", JSON.stringify({ url: "", token, name: "家" }));
        if (doneOnboarding) {
          localStorage.setItem("wp.hint.poke", "1");
        }
      } catch { /* ignore */ }
    }, { token: TOKEN, doneOnboarding: true, paired });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    return { context, page };
  };
  const shot = async (page, name, size) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, `${name}-${size[0]}x${size[1]}.png`) });
  };
  const finishOnboarding = async (page) => {
    // 引导页：能跳就跳
    const skip = page.getByText("跳过，以后再说");
    if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(400); }
  };

  for (const size of SIZES) {
    const { context, page } = await newDevice(size);
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(1200);
    await finishOnboarding(page);
    await page.goto(`${BASE}/`);
    await page.waitForSelector("textarea", { timeout: 15000 });
    // 聊天：发一条消息
    await page.fill("textarea", "刚下班，有点累。");
    await shot(page, "chat-1-composed", size);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    await shot(page, "chat-2-streaming", size);
    await page.waitForTimeout(3500);
    await shot(page, "chat-3-replied", size);
    const hint = await page.locator(".composer__keys").innerText().catch(() => "");
    check(/Enter 发送/.test(hint) && /Shift\+Enter 换行/.test(hint), `输入栏提示：${hint}`);
    // 日记：用这轮对话生成当天日记
    await call("/api/journals/generate", { method: "POST", body: JSON.stringify({ character: "whale", force: true }) });
    await page.goto(`${BASE}/diary`);
    await shot(page, "diary", size);
    await page.goto(`${BASE}/memory`);
    await shot(page, "memory", size);
    await page.goto(`${BASE}/surf`);
    await page.waitForTimeout(800);
    await shot(page, "surf", size);
    // 「和她聊聊」→ ?quote=
    const talk = page.getByText("和她聊聊").first();
    if (await talk.count()) {
      await talk.click().catch(() => {});
    } else {
      await page.goto(`${BASE}/?quote=${encodeURIComponent("我看到你逛到了《鲸歌是怎么传遍整片海的》\nhttps://example.org/whale-song")}`);
    }
    await page.waitForTimeout(1200);
    if (!page.url().endsWith("/") && !page.url().includes("quote")) await page.goto(`${BASE}/?quote=${encodeURIComponent("我看到你逛到了《鲸歌》")}`);
    await page.waitForTimeout(1000);
    const draft = await page.locator("textarea").first().inputValue().catch(() => "");
    check(draft.includes("我看到你逛到了"), `?quote= 预填输入框：${JSON.stringify(draft.slice(0, 24))}`);
    check(!page.url().includes("quote="), "读完后 ?quote= 已从地址栏清掉");
    await shot(page, "chat-4-quote-prefilled", size);
    await page.goto(`${BASE}/settings`);
    await shot(page, "settings", size);
    // 设置里「我的设备」→ 添加设备
    const add = page.getByRole("button", { name: /添加设备/ }).first();
    if (await add.count()) {
      await add.scrollIntoViewIfNeeded();
      await add.click();
      await page.waitForTimeout(1200);
      await shot(page, "add-device-dialog", size);
      await page.keyboard.press("Escape");
    } else {
      check(false, "设置页没找到「添加设备」按钮");
    }
    // 窄一点时的失败纸条 / 加载（本环境没有模型文件，应当看到海平线或底部纸条）
    await context.close();
  }

  // ---- 两台设备：A 发，B 实时出现 ----
  const size = SIZES[0];
  const a = await newDevice(size);
  const pair = await (await call("/api/pair/create", { method: "POST", body: "{}" })).json();
  const code = pair.code ?? pair.pairingCode ?? Object.values(pair).find((v) => /^\d{6}$/.test(String(v)));
  check(Boolean(code), `生成配对码 ${code ?? JSON.stringify(pair)}`);
  const b = await newDevice(size, { paired: true });
  await a.page.goto(`${BASE}/`);
  await a.page.waitForTimeout(1200);
  await finishOnboarding(a.page);
  await a.page.goto(`${BASE}/`);
  await b.page.goto(`${BASE}/?pair=${code}`);
  await a.page.waitForSelector("textarea", { timeout: 15000 });
  await b.page.waitForTimeout(1200);
  await finishOnboarding(b.page);
  await b.page.goto(`${BASE}/`);
  await b.page.waitForSelector("textarea", { timeout: 20000 }).catch(() => {});
  await b.page.waitForTimeout(1500);
  const marker = `两台设备测试 ${Date.now() % 100000}`;
  await a.page.fill("textarea", marker);
  await a.page.keyboard.press("Enter");
  let seenOnB = false;
  for (let i = 0; i < 20 && !seenOnB; i += 1) {
    await b.page.waitForTimeout(500);
    // 对话框只显示她的最后一句；你的话在「往回翻」里。
    const open = b.page.getByRole("button", { name: "往回翻" });
    if (i === 0 && (await open.count())) await open.first().click().catch(() => {});
    seenOnB = (await b.page.content()).includes(marker);
  }
  check(seenOnB, "A 发消息后 B 实时出现（无需刷新）");
  await b.page.waitForTimeout(3500);
  const replyOnB = (await b.page.content()).includes("小石头");
  check(replyOnB, "她的回复也实时流到 B");
  await a.page.screenshot({ path: join(OUT, `two-devices-A-${size[0]}x${size[1]}.png`) });
  await b.page.screenshot({ path: join(OUT, `two-devices-B-${size[0]}x${size[1]}.png`) });

  // 日记页实时刷新：B 停在日记页，A 触发生成日记
  await b.page.goto(`${BASE}/diary`);
  await b.page.waitForTimeout(1500);
  const before = (await b.page.content()).length;
  const events = [];
  b.page.on("request", (r) => { if (r.url().includes("/api/journals")) events.push(r.url()); });
  await call("/api/journals/generate", { method: "POST", body: JSON.stringify({ character: "whale", force: true }) });
  await b.page.waitForTimeout(2500);
  check(events.length > 0, `日记生成后 B 的日记页自动重拉（${events.length} 次 /api/journals 请求）`);
  void before;

  await browser.close();
} catch (error) {
  console.error(error);
  failures += 1;
} finally {
  await cleanup();
}
writeFileSync(join(OUT, "RESULT.txt"), failures === 0 ? "ALL PASS\n" : `FAILURES: ${failures}\n`);
console.log(failures === 0 ? "ALL PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
