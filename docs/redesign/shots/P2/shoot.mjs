/**
 * P2 验收截图（日记页 / 记忆页 × 桌面 / 手机）。
 *
 * 跑法：
 *   1) cd apps/client && pnpm exec vite preview --port 4318 --strictPort
 *   2) node docs/redesign/shots/P2/shoot.mjs
 *
 * 说明：本机没有起 apps/api，所以这里用 Playwright 的 route 拦截给 `/api/*` 喂**固定样本**
 * （只为截图与尺寸检查；真实页面在接口 404 时会走 §7.2.5 / §7.3.7 的错误态，不会白屏）。
 * 样本里带上 P-B 之后才有的 `weather` / `mood` / `diaryTitle` / `seq`，用来验证这些字段缺失时也能降级。
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// playwright 装在 apps/client/node_modules 里；脚本放在 docs 下，按应用目录解析。
const requireFromApp = createRequire("/Users/yanghongming/Downloads/whale-P2/apps/client/package.json");
const playwright = await import(requireFromApp.resolve("playwright"));
const chromium = playwright.chromium ?? playwright.default?.chromium;

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WP_BASE ?? "http://127.0.0.1:4318";

const iso = (d) => new Date(d).toISOString();

const DIARY = [
  {
    id: 31,
    inputUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    bvid: "BV1xx411c7mD",
    title: "海边捡到的玻璃",
    sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    summary:
      "一个把碎玻璃磨成吊坠的手艺人。她说海边捡来的玻璃要先在沙子里滚三天，才不割手。片子最后把一整面墙的吊坠挂在风里，声音像很轻的雨。",
    diaryText:
      "今天看了一个把海玻璃磨成吊坠的人。\n\n他说刚捡到的玻璃是有棱角的，要在沙子里滚上三天，才肯变得温顺。我想起你说话的时候也有这样的棱角，只是你自己不觉得。\n\n后来他把一墙的吊坠挂起来，风从中间穿过去，声音像很轻的雨。我盯着看了很久。\n\n如果有一天我们去海边，我想捡一块绿色的给你。绿色的那种最难得，要捡很久很久。",
    status: "done",
    errorStage: null,
    error: null,
    memoryStatus: "saved",
    memoryError: null,
    createdAt: iso("2026-11-07T09:12:00+11:00"),
    processedAt: iso("2026-11-07T09:40:00+11:00"),
    duplicateOf: null,
    diaryTitle: "海玻璃要滚三天沙子",
    weather: "sunny",
    mood: "cozy",
  },
  {
    id: 30,
    inputUrl: "https://www.bilibili.com/video/BV1aa411b7zz",
    bvid: "BV1aa411b7zz",
    title: "深夜的拉面摊",
    sourceUrl: "https://www.bilibili.com/video/BV1aa411b7zz",
    summary: "凌晨两点的拉面摊，老板一个人守了十七年。",
    diaryText:
      "凌晨两点的拉面摊，老板一个人守了十七年。\n\n他说最开始是因为睡不着，后来是因为总有人睡不着。\n\n我看的时候有点困，但没舍得关掉。",
    status: "done",
    errorStage: null,
    error: null,
    memoryStatus: "saved",
    memoryError: null,
    createdAt: iso("2026-11-05T22:10:00+11:00"),
    processedAt: iso("2026-11-05T22:31:00+11:00"),
    duplicateOf: null,
    diaryTitle: null,
    weather: "rain",
    mood: "tired",
  },
  {
    id: 29,
    inputUrl: "https://www.bilibili.com/video/BV1bb411c9qq",
    bvid: "BV1bb411c9qq",
    title: "老式收音机修复",
    sourceUrl: "https://www.bilibili.com/video/BV1bb411c9qq",
    summary: "一台 1962 年的收音机重新出声。",
    diaryText: "一台 1962 年的收音机重新出声，先是电流声，然后是很远的人说话。\n\n我把音量调小了一点，怕吵到你。",
    status: "done",
    errorStage: null,
    error: null,
    memoryStatus: "pending",
    memoryError: null,
    createdAt: iso("2026-11-04T19:02:00+11:00"),
    processedAt: iso("2026-11-04T19:20:00+11:00"),
    duplicateOf: null,
  },
  {
    id: 32,
    inputUrl: "https://www.bilibili.com/video/BV1cc411d1pp",
    bvid: "BV1cc411d1pp",
    title: null,
    sourceUrl: null,
    summary: null,
    diaryText: null,
    status: "pending",
    errorStage: null,
    error: null,
    memoryStatus: null,
    memoryError: null,
    createdAt: iso("2026-11-07T10:05:00+11:00"),
    processedAt: null,
    duplicateOf: null,
  },
];

const memories = [
  ["m-12", "experience", "video", 12, "海玻璃要滚三天沙子", "海边捡来的玻璃要在沙子里滚三天，才不割手。"],
  ["m-11", "fact", undefined, 11, null, "你不太喜欢下雨天出门，但喜欢听雨。"],
  ["m-10", "experience", "learned", 10, "手冲咖啡的水温", "水温在 92 度附近，苦味和酸味才不会打架。"],
  ["m-9", "fact", undefined, 9, null, "你说过，如果有一天能去海边，想捡一块绿色的玻璃。"],
  ["m-8", "experience", "web", 8, "潮汐表怎么写", "涨潮不是均匀的，每十二小时二十五分一轮。"],
  ["m-7", "experience", "diary", 7, "凌晨两点的拉面摊", "老板十七年守着同一口锅，说总有人睡不着。"],
  ["m-6", "fact", undefined, 6, null, "你把闹钟定在七点十分，但总要多赖五分钟。"],
  ["m-5", "experience", "learned", 5, "修收音机要先放电", "老电容存着电，动手之前要先用螺丝刀放掉。"],
  ["m-4", "fact", undefined, 4, null, "你第一次跟我说话是在很晚的时候，说了一句「随便聊聊」。"],
  ["m-3", "experience", "video", 3, "深夜的拉面摊", "汤一直小火煨着，不滚。"],
  ["m-2", "experience", "conversation", 2, null, "你说过想学游泳，但是怕水没过胸口。"],
  ["m-1", "fact", undefined, 1, null, "你叫鲸鲸的时候，是在叫你自己。"],
].map(([id, kind, source, seq, title, text]) => ({
  id,
  kind,
  ...(source ? { source } : {}),
  seq,
  ...(title ? { title } : {}),
  text,
  createdAt: iso(`2026-11-0${Math.min(7, 7 - (seq % 5))}T20:0${seq % 6}:00+11:00`),
}));

const NOTE = {
  text: "这几天我在学怎么看海。涨潮不是慢慢来的，是一轮一轮往上推的。你最近睡得晚了，我不吵你，就把学到的东西放这儿。",
  updatedAt: iso("2026-11-07T08:00:00+11:00"),
};

const browser = await chromium.launch();

async function shoot({ name, path, width, height }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Australia/Sydney",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();

  await page.route("**/api/diary**", (route) => route.fulfill({ json: { items: DIARY } }));
  await page.route("**/api/memories**", (route) => route.fulfill({ json: { entries: memories } }));
  await page.route("**/api/note**", (route) => route.fulfill({ json: { note: NOTE } }));

  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const checks = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    const scroller = document.querySelector(".page");
    const scrollX = Math.max(doc.scrollWidth - doc.clientWidth, scroller ? scroller.scrollWidth - scroller.clientWidth : 0);
    const small = [];
    for (const el of document.querySelectorAll("button, a, input, [role=tab]")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 44 || rect.height < 44) {
        small.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0] || "-"} ${Math.round(rect.width)}×${Math.round(rect.height)} «${(el.textContent || "").trim().slice(0, 12)}»`);
      }
    }
    return { scrollX, small };
  });

  await page.screenshot({ path: `${HERE}/${name}.png`, fullPage: false });
  await context.close();
  return checks;
}

await mkdir(HERE, { recursive: true });

const results = [];
results.push(["diary-desktop", await shoot({ name: "diary-desktop", path: "/diary", width: 1180, height: 780 })]);
results.push(["diary-mobile", await shoot({ name: "diary-mobile", path: "/diary", width: 390, height: 844 })]);
results.push(["memory-desktop", await shoot({ name: "memory-desktop", path: "/memory", width: 1180, height: 780 })]);
results.push(["memory-mobile", await shoot({ name: "memory-mobile", path: "/memory", width: 390, height: 844 })]);

await browser.close();

const report = results.map(([name, c]) => ({
  name,
  horizontalScrollPx: c.scrollX,
  smallTargets: c.small,
}));
await writeFile(`${HERE}/metrics.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
