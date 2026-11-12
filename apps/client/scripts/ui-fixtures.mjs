/**
 * 浏览器检查共用的假后端：ui-check 与 perf-idle 都用它，页面不连真实 API（不占 8787）。
 */
export const NOW = "2026-11-06T10:00:00+11:00";
export const FIXTURES = {
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

export async function stubApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/api/health")) return json({ ok: true, provider: "stub", model: "stub" });
    if (url.includes("/api/chat/history")) return json(FIXTURES.history);
    if (url.includes("/api/diary")) return json(FIXTURES.diary);
    if (url.includes("/api/memories")) return json(FIXTURES.memories);
    if (url.includes("/api/note")) return json({ note: { text: "今天在窗台上发现一只小螃蟹。", updatedAt: NOW } });
    if (url.includes("/api/quota")) return json(FIXTURES.quota);
    if (url.includes("/api/profile")) return json({ nickname: "阿明" });
    // 设置页读这两项设置，缺了会整页白屏（0.3.4 起 ui-check 拍到的设置页一直是空白）
    if (url.includes("/api/companion/settings")) return json({ enabled: true, frequency: "normal", quiet: { start: "23:00", end: "08:00" } });
    if (url.includes("/api/surf/settings")) return json({ character: "whale", enabled: true, frequency: "normal", interests: ["海洋", "手作"], blocked: [], quiet: { start: "23:00", end: "08:00" }, video: true, web: true, shareToChat: true, webAvailable: true, browser: { state: "ready", percent: null, message: "" } });
    if (url.includes("/api/surf/status")) return json({ running: false, sessionId: null, stage: null, todayCount: 2, lastRunAt: NOW, nextRunAt: null, pausedReason: null, webAvailable: true });
    if (url.includes("/api/devices")) return json({ devices: [] });
    if (url.includes("/api/accounts")) return json({ accounts: [{ platform: "bilibili", name: "哔哩哔哩", connected: false, valid: null, savedAt: null }] });
    return json({});
  });
}

