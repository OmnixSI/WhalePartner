import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { applyCors, sendJson } from "./http.ts";
import { createChatProvider } from "./llm/index.ts";
import { LazyMemoryStore } from "./memory/mem0.ts";
import { scheduleMemoryJobs, waitForMemoryJobs } from "./memory/jobs.ts";
import { DEFAULT_CHARACTER, isCharacterId } from "./persona/persona.ts";
import { ChatStore } from "./store.ts";
import { createVideoService } from "./video-service.ts";
import { createAccountService } from "./accounts.ts";
import { createWebService } from "./web-service.ts";
import { DiaryStore } from "./diary-store.ts";
import { DiaryService } from "./diary-service.ts";
import { startDiaryScheduler } from "./diary-scheduler.ts";
import { JournalStore } from "./journal-store.ts";
import { DailyJournalService } from "./daily-journal.ts";
import { startDailyJournalScheduler } from "./daily-journal-scheduler.ts";
import { handleAccountsRoute } from "./routes/accounts.ts";
import { handleChatHistoryRoute } from "./routes/chat-history.ts";
import { handleChatRoute } from "./routes/chat.ts";
import { ChatSessionRequests } from "./routes/chat-session-requests.ts";
import { handleDiaryRoute } from "./routes/diary.ts";
import { handleJournalsRoute } from "./routes/journals.ts";
import { handleMemoriesRoute } from "./routes/memories.ts";
import { handleQuotaRoute } from "./routes/quota.ts";
import { handleProfileRoute } from "./routes/profile.ts";
import { handleExportRoute, dataMaintenanceBusy } from "./routes/export.ts";
import { handleVideoSummaryRoute } from "./routes/video-summary.ts";
import { handleSurf } from "./routes/surf.ts";
import { createSurf } from "./surf/index.ts";
import type { ServerDeps } from "./server-types.ts";
export type { ServerDeps } from "./server-types.ts";

// 她逛之前先看用户在不在聊：最后一次聊天时间。main 的 routes/chat.ts 里没有这个状态，这里补一个。
const chatActivity = { last: 0 };

function healthBody(deps: ServerDeps) {
  const { provider } = deps;
  return {
    ok: true,
    service: "whalepartner-api",
    provider: provider.id,
    model: provider.model,
    fallbacks: provider.providers.slice(1).map((item) => item.id),
    memory: deps.memory?.status?.() ?? { enabled: Boolean(deps.memory), state: deps.memory ? "ready" : "idle" },
    memoryQueue: deps.store.memoryQueueStatus(),
    // B6.4：把 cron 里的时间摊给人看（界面「她一般什么时候写日记」用它）。
    schedule: { journalTime: cronClock(deps.config.diaryCron) },
  };
}

/** `0 20 * * *` → `20:00`；解析不了就原样返回。 */
function cronClock(cron: string): string {
  const [minute, hour] = cron.trim().split(/\s+/);
  if (!/^\d{1,2}$/.test(minute ?? "") || !/^\d{1,2}$/.test(hour ?? "")) return cron;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

async function probe({ provider }: ServerDeps) {
  const primary = provider.providers[0];
  if (!primary.listModels) return { checked: false as const };
  try {
    const models = await primary.listModels();
    return { checked: true as const, modelAvailable: models.includes(primary.model) };
  } catch (error) {
    return { checked: true as const, modelAvailable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createApiServer(deps: ServerDeps): Server {
  const sessionRequests = new ChatSessionRequests();
  return createServer(async (request, response) => {
    applyCors(request, response);
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        const body = healthBody(deps);
        sendJson(response, 200, url.searchParams.get("probe") === "1" ? { ...body, probe: await probe(deps) } : body);
        return;
      }
      if (url.pathname === "/api/accounts" || url.pathname.startsWith("/api/accounts/")) {
        await handleAccountsRoute(deps, request, response, url);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/note") {
        const character = url.searchParams.get("character") ?? DEFAULT_CHARACTER;
        if (!isCharacterId(character)) return sendJson(response, 400, { error: "未知的角色。" });
        const note = deps.store.getNote(character);
        return sendJson(response, 200, { note: note ? { text: note.text, updatedAt: note.updatedAt } : null });
      }
      if (url.pathname === "/api/surf" || url.pathname.startsWith("/api/surf/")) {
        await handleSurf(deps, request, response, url);
        return;
      }
      if (await handleQuotaRoute(deps, request, response, url)) return;
      if (await handleProfileRoute(deps, request, response, url)) return;
      if (await handleExportRoute(deps, request, response, url)) return;
      if (await handleChatHistoryRoute(deps, request, response, url, sessionRequests)) return;
      if (url.pathname === "/api/diary" || url.pathname.startsWith("/api/diary/")) {
        await handleDiaryRoute(deps, request, response, url);
        return;
      }
      if (url.pathname === "/api/journals" || url.pathname.startsWith("/api/journals/")) {
        await handleJournalsRoute(deps, request, response, url);
        return;
      }
      if (url.pathname.startsWith("/api/memories")) {
        await handleMemoriesRoute(deps, request, response, url);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/videos/summarize") {
        await handleVideoSummaryRoute(deps, request, response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/chat") {
        if (dataMaintenanceBusy()) { sendJson(response, 409, { error: "busy", message: "正在导出或删除，稍等一下再聊。" }); return; }
        chatActivity.last = Date.now();
        await handleChatRoute(deps, request, response, sessionRequests);
        return;
      }
      sendJson(response, 404, { error: "未找到。" });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "服务内部错误。" });
    }
  });
}

if (import.meta.main) {
  const config = loadConfig();
  const lan = process.argv.includes("--lan");
  const host = lan ? "0.0.0.0" : config.host;
  const provider = createChatProvider(config);
  const store = new ChatStore(config.dbPath);
  if (config.memoryEnabled && !existsSync(join(config.memoryDir, "vectors.db"))) store.resetMemoryVectorIndexes();
  const diaryStore = new DiaryStore(config.dbPath);
  const journalStore = new JournalStore(config.dbPath);
  const memory = config.memoryEnabled
    ? new LazyMemoryStore({ dataDir: config.memoryDir, provider, archive: store })
    : undefined;
  const video = createVideoService();
  const diary = new DiaryService({ store: diaryStore, archive: store, provider, memory, video });
  const journal = new DailyJournalService({ store: journalStore, archive: store, provider, memory });
  const surf = createSurf({
    dbPath: config.dbPath,
    config,
    provider,
    memory,
    messages: store,
    journal: diary,
    isUserChatting: () => Date.now() - chatActivity.last < 3 * 60_000,
    userIdleMinutes: () => (chatActivity.last === 0 ? Number.POSITIVE_INFINITY : (Date.now() - chatActivity.last) / 60_000),
  });
  let stopSurfScheduler = () => {};
  const server = createApiServer({ config, provider, store, memory, video, diary, journal, surf: surf.service, web: createWebService(), accounts: createAccountService() });
  let stopDiaryScheduler = () => {};
  let stopJournalScheduler = () => {};
  server.on("close", () => {
    stopDiaryScheduler();
    stopJournalScheduler();
    void Promise.all([diary.waitForIdle(), journal.waitForIdle(), waitForMemoryJobs(store)]).finally(() => {
      journalStore.close();
      diaryStore.close();
      store.close();
    });
  });
  server.on("close", () => { stopSurfScheduler(); });
  server.listen(config.port, host, () => {
    if (config.surfEnabled) stopSurfScheduler = surf.start();
    void scheduleMemoryJobs({ store, provider, memory });
    stopDiaryScheduler = startDiaryScheduler(config.diaryCron, diary);
    stopJournalScheduler = startDailyJournalScheduler(config.journalCron, journal);
    void journal.resumeInterrupted();
    console.log(`WhalePartner API：http://${host}:${config.port}`);
    console.log(`旧视频日记计划：${config.diaryCron}（本机时区；API 运行时生效）`);
    console.log(`每日综合日记计划：${config.journalCron}（本机时区；API 运行时生效）`);
    console.log(`模型链：${provider.providers.map((item) => `${item.id}(${item.model})`).join(" → ")}`);
    if (lan) console.log("已开放局域网访问。没有登录保护，只在可信网络里使用。");
  });
}
