#!/usr/bin/env node
/**
 * 冲刺截图：聊天 / 日记 / 记忆 / 设置 × 5 个窗口尺寸 × 亮/暗（可选老人模式），固定数据桩，不依赖后端。
 *
 *   node scripts/redesign/sprint-shots.mjs [--base=http://127.0.0.1:1431] [--out=docs/redesign/shots/sprint]
 *        [--sizes=380x560,960x700] [--pages=chat,diary] [--themes=light,dark] [--elder]
 *   WP_CHROME=/usr/bin/google-chrome   指定浏览器（没装 playwright 自带浏览器时用）
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = arg("base", "http://127.0.0.1:1431");
const OUT = join(ROOT, arg("out", "docs/redesign/shots/sprint"));
const SIZES = arg("sizes", "380x560,960x700,1180x780,1920x1080,2560x1440").split(",").map((s) => s.split("x").map(Number));
const PAGES = arg("pages", "chat,diary,memory,settings").split(",");
const THEMES = arg("themes", "light,dark").split(",");
const ELDER = process.argv.includes("--elder");
const PATH = { chat: "/", diary: "/diary", memory: "/memory", settings: "/settings", surf: "/surf" };

const NOW = "2026-11-06T10:00:00+11:00";
const FIXTURES = {
  history: {
    messages: [
      { id: 1, role: "assistant", content: "你回来啦。今天海面很平，我在这里等你。", emotion: "happy", createdAt: NOW },
      { id: 2, role: "user", content: "刚下班，有点累。", emotion: null, createdAt: NOW },
      { id: 3, role: "assistant", content: "那就先坐一会儿。我把今天捡到的一颗小石头放在你手边了。", emotion: "relaxed", createdAt: NOW },
      { id: 4, role: "user", content: "谢谢。你今天做什么了？", emotion: null, createdAt: NOW },
      { id: 5, role: "assistant", content: "我把昨天看到的那个视频写成了日记，写在第三页。", emotion: "happy", createdAt: NOW },
      { id: 6, role: "user", content: "晚点我去看看。", emotion: null, createdAt: NOW },
    ],
  },
  diary: {
    items: [
      { id: 1, inputUrl: "https://www.bilibili.com/video/BV1xx411c7mD", bvid: "BV1xx411c7mD", title: "海边捡到的第一块玻璃", sourceUrl: null, summary: "一个把碎玻璃磨成小石头的短片。", diaryText: "今天看到一个把碎玻璃磨成小石头的短片。\n\n海浪一次次推上来，又退回去，玻璃就慢慢圆了。我想起你上次说的那句「有些事只是需要时间」。", status: "done", errorStage: null, error: null, memoryStatus: "saved", memoryError: null, createdAt: "2026-11-05T10:00:00+11:00", processedAt: "2026-11-05T10:02:00+11:00", duplicateOf: null },
      { id: 2, inputUrl: "https://www.bilibili.com/video/BV1yy411c7mE", bvid: "BV1yy411c7mE", title: "灯塔守夜人的一天", sourceUrl: null, summary: "守夜人怎么过一天。", diaryText: "守夜人一天只做三件事：擦灯、看海、记天气。他说，安静不是没有声音，是知道声音从哪来。", status: "done", errorStage: null, error: null, memoryStatus: "saved", memoryError: null, createdAt: "2026-11-04T10:00:00+11:00", processedAt: "2026-11-04T10:02:00+11:00", duplicateOf: null },
      { id: 3, inputUrl: "https://www.bilibili.com/video/BV1zz411c7mF", bvid: null, title: null, sourceUrl: null, summary: null, diaryText: null, status: "pending", errorStage: null, error: null, memoryStatus: null, memoryError: null, createdAt: "2026-11-06T09:00:00+11:00", processedAt: null, duplicateOf: null },
    ],
  },
  memories: {
    entries: [
      { id: "m1", text: "你下班回家的时候，通常先说一句「我回来了」。", kind: "fact", createdAt: "2026-11-05T10:00:00+11:00" },
      { id: "m2", text: "你说累的时候，更想有人陪着，而不是被建议。", kind: "fact", createdAt: "2026-11-03T10:00:00+11:00" },
      { id: "m3", text: "海边捡到玻璃的事，你听了很久。", kind: "experience", createdAt: "2026-11-02T10:00:00+11:00", source: "bilibili", title: "海边捡到的第一块玻璃", url: "https://www.bilibili.com/video/BV1xx411c7mD" },
      { id: "m4", text: "你不太喜欢在晚上做决定。", kind: "fact", createdAt: "2026-10-28T10:00:00+11:00" },
    ],
  },
  quota: {
    billing: "off", enforced: false,
    period: { start: "2026-11-01", end: "2026-11-30", resetsAt: "2026-12-01T00:00:00+11:00" },
    total: 1000, used: 320, remaining: 680, low: false,
    breakdown: { chat: 120, video: 100, web: 40, journal: 40, surf: 20 },
    costs: { chat: 2, video: 10, web: 4, journal: 6, surfVideo: 12, surfWeb: 5 },
    today: { used: 12 },
  },
};

async function stubApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/api/health")) return json({ ok: true, provider: "stub", model: "stub" });
    if (url.includes("/api/chat/history")) return json(FIXTURES.history);
    if (url.includes("/api/surf/settings")) return json({ character: "deepseek", enabled: true, frequency: "normal", interests: ["海","旧物"], blocked: [], video: true, web: true, shareToChat: true, webAvailable: true, quiet: { start: "23:00", end: "07:00" } });
    if (url.includes("/api/surf/status")) return json({ running: false, sessionId: null, stage: null, todayCount: 1, lastRunAt: null, nextRunAt: null, pausedReason: null, webAvailable: true });
    if (url.includes("/api/surf/feed")) return json({ items: [], total: 0, page: 1, pageSize: 12 });
    if (url.includes("/api/journals")) {
      const d = (n, t) => ({ id: "j" + n, character: "deepseek", localDate: `2026-11-0${n}`, revision: 1, text: t, sources: [], modelId: "stub", createdAt: NOW });
      return json({ total: 2, items: [d(7, "今天你说有点累，我就把窗台上的小石头擦了一遍。\n\n晚上海很安静，我想你应该也睡得很好。"), d(6, "今天看了一个把碎玻璃磨成小石头的短片。海浪一次次推上来，又退回去，玻璃就慢慢圆了。")] });
    }
    if (url.includes("/api/diary")) return json(FIXTURES.diary);
    if (url.includes("/api/memories")) return json(FIXTURES.memories);
    if (url.includes("/api/note")) return json({ note: { text: "今天在窗台上发现一只小螃蟹。", updatedAt: NOW } });
    if (url.includes("/api/quota")) return json(FIXTURES.quota);
    if (url.includes("/api/profile")) return json({ nickname: "阿明" });
    if (url.includes("/api/accounts")) return json({ accounts: [{ platform: "bilibili", name: "哔哩哔哩", connected: false, valid: null, savedAt: null }] });
    return json({});
  });
}


const require = createRequire(join(ROOT, "apps", "client", "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch(process.env.WP_CHROME ? { executablePath: process.env.WP_CHROME } : {});
mkdirSync(OUT, { recursive: true });
const overflow = [];
for (const theme of THEMES) {
  for (const [width, height] of SIZES) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
    await context.addInitScript(({ theme, elder }) => {
      localStorage.setItem("wp.onboarded", "1");
      localStorage.setItem("wp.theme", theme);
      if (elder) localStorage.setItem("wp.elder", "on");
    }, { theme, elder: ELDER });
    const page = await context.newPage();
    await stubApi(page);
    page.on("pageerror", (e) => overflow.push(`pageerror ${width}x${height}: ${String(e).slice(0, 160)}`));
    for (const name of PAGES) {
      await page.goto(BASE + PATH[name], { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(900);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (sw[0] > sw[1]) overflow.push(`${name} ${width}x${height} ${theme}: ${sw[0]}>${sw[1]}`);
      const file = join(OUT, `${name}-${width}x${height}-${theme}${ELDER ? "-elder" : ""}.png`);
      await page.screenshot({ path: file });
      console.log(file.replace(ROOT + "/", ""));
    }
    await context.close();
  }
}
await browser.close();
console.log(overflow.length ? "横向溢出：\n" + overflow.join("\n") : "无横向溢出");
