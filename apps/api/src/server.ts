import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.ts";
import { applyCors, sendJson } from "./http.ts";
import { authOptionsFromEnv, authorize, authRequiredFor, type AuthOptions } from "./auth.ts";
import { DeviceRegistry } from "./devices.ts";
import { hubEvents } from "./events.ts";
import { handleHubRoute } from "./routes/hub.ts";
import { serveStatic } from "./static.ts";
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
import { handleCompanionRoute } from "./routes/companion.ts";
import { handleChatRoute } from "./routes/chat.ts";
import { ChatSessionRequests } from "./routes/chat-session-requests.ts";
import { handleDiaryRoute } from "./routes/diary.ts";
import { handleJournalsRoute } from "./routes/journals.ts";
import { handleMemoriesRoute } from "./routes/memories.ts";
import { handleQuotaRoute } from "./routes/quota.ts";
import { handleProfileRoute } from "./routes/profile.ts";
import { handleSetupRoute } from "./routes/setup.ts";
import { handleExportRoute, dataMaintenanceBusy } from "./routes/export.ts";
import { handleVideoSummaryRoute } from "./routes/video-summary.ts";
import { handleSurf } from "./routes/surf.ts";
import { createSurf, stopSurf } from "./surf/index.ts";
import { CHAT_RESUME_MS } from "./surf/service.ts";
import type { ServerDeps } from "./server-types.ts";
import { PresenceRegistry } from "./proactive/presence.ts";
import { ProactiveService } from "./proactive/service.ts";
export type { ServerDeps } from "./server-types.ts";

// 她逛之前先看用户在不在聊：最后一次聊天时间。main 的 routes/chat.ts 里没有这个状态，这里补一个。
const chatActivity = { last: 0 };

function healthBody(deps: ServerDeps, authRequired = false) {
  const { provider } = deps;
  return {
    ok: true,
    ...(authRequired ? { authRequired: true } : {}),
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
  const presence = new PresenceRegistry();
  const devices = deps.auth?.devices ?? new DeviceRegistry(deviceFile(deps.config.dbPath));
  const auth: AuthOptions = { ...deps.auth, devices };
  const events = deps.events ?? hubEvents;
  const proactive = new ProactiveService({
    store: deps.store,
    provider: deps.provider,
    config: deps.config,
    memory: deps.memory,
    events,
    presence,
    requests: sessionRequests,
    lastChatActivity: () => chatActivity.last,
  });
  let port = deps.config.port;
  const server = createServer(async (request, response) => {
    applyCors(request, response, auth.extraOrigins);
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      const verdict = authorize(request, url, auth);
      if (!verdict.ok) {
        sendJson(response, verdict.status, { error: verdict.error, code: verdict.code });
        return;
      }
      if (serveStatic(deps.staticDir, request, response, url.pathname)) return;
      const address = server.address();
      if (address && typeof address === "object") port = address.port;
      if (await handleHubRoute({ devices, events, port }, request, response, url)) return;
      if (request.method === "GET" && url.pathname === "/api/health") {
        const body = healthBody(deps, authRequiredFor(request, auth));
        sendJson(response, 200, url.searchParams.get("probe") === "1" ? { ...body, probe: await probe(deps) } : body);
        return;
      }
      if (await handleSetupRoute(deps, request, response, url)) return;
      if (await handleCompanionRoute({ store: deps.store, presence, events }, request, response, url)) return;
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
        await handleChatRoute({ ...deps, events }, request, response, sessionRequests);
        return;
      }
      sendJson(response, 404, { error: "未找到。" });
    } catch (error) {
      console.warn("请求处理失败：", error instanceof Error ? error.stack ?? error.message : error);
      if (!response.headersSent) sendJson(response, 500, { error: "服务内部错误。" });
      else response.end();
    }
  });
  server.on("listening", () => proactive.start());
  server.on("close", () => proactive.stop());
  return server;
}

/** 已配对设备存在数据库旁边；内存库 / 无路径时只放内存。 */
function deviceFile(dbPath: string): string | undefined {
  return dbPath && dbPath !== ":memory:" ? join(dirname(dbPath), "devices.json") : undefined;
}

/** 端口被占用时的退出码，桌面外壳据此换端口重试。 */
const EXIT_ADDR_IN_USE = 98;

if (import.meta.main) {
  const config = loadConfig();
  const lanFlag = process.argv.includes("--lan");
  const host = lanFlag ? "0.0.0.0" : config.host;
  // 只要不是只听回环地址（--lan 或 API_HOST=0.0.0.0，如 Docker），就必须带令牌。
  const lan = lanFlag || !["127.0.0.1", "localhost", "::1"].includes(host);
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
    isUserChatting: () => chatActivity.last !== 0 && Date.now() - chatActivity.last < CHAT_RESUME_MS,
    userIdleMinutes: () => (chatActivity.last === 0 ? Number.POSITIVE_INFINITY : (Date.now() - chatActivity.last) / 60_000),
  });
  let stopSurfScheduler = () => {};
  const devices = new DeviceRegistry(deviceFile(config.dbPath));
  const auth = authOptionsFromEnv(lan, devices);
  let generatedToken = false;
  // --lan 必须带 token：没配就生成一个，打印在启动日志里。
  if (lan && !auth.localToken) {
    auth.localToken = randomBytes(24).toString("base64url");
    generatedToken = true;
  }
  const staticDir = process.env.WP_STATIC_DIR || join(import.meta.dirname, "../../client/dist");
  const server = createApiServer({ config, provider, store, memory, video, diary, journal, surf: surf.service, web: createWebService(), accounts: createAccountService(), auth, staticDir: existsSync(staticDir) ? staticDir : undefined });
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
  // 收尾幂等：stopSurfScheduler / stopSurf 重复调用无副作用，shutdown 与 server.close 可各走一次。
  server.on("close", () => { stopSurfScheduler(); void stopSurf().catch(() => {}); });
  // 端口被占：打印明确原因，用固定退出码 98 退出（桌面外壳据此换端口重试）。
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${config.port} 已被占用（EADDRINUSE）。换一个 API_PORT，或关掉占用它的旧后端。`);
      process.exit(EXIT_ADDR_IN_USE);
    }
    console.error("后端监听失败：", error);
    process.exit(1);
  });

  // 优雅退出：SIGTERM/SIGINT，或 stdin 关闭（父进程 App 没了），都走这里，避免留下孤儿进程。
  let shuttingDown = false;
  const shutdown = (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`后端正在退出（${reason}）…`);
    const hardExit = setTimeout(() => process.exit(0), 2500);
    hardExit.unref();
    void (async () => {
      stopSurfScheduler();
      try {
        await stopSurf();
      } catch {
        // 浏览器关闭失败不拦退出
      }
      stopDiaryScheduler();
      stopJournalScheduler();
      server.close(() => process.exit(0));
      server.closeAllConnections();
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  // 只有被桌面外壳拉起（stdin 是管道）时才监听 stdin 关闭；终端里手动跑不受影响。
  if (process.env.WP_LOCAL_TOKEN && !process.stdin.isTTY) {
    process.stdin.on("end", () => shutdown("stdin 已关闭"));
    process.stdin.on("close", () => shutdown("stdin 已关闭"));
    process.stdin.resume();
  }

  server.listen(config.port, host, () => {
    if (config.surfEnabled) stopSurfScheduler = surf.start();
    void surf.repairMissingThumbnails().catch((error: unknown) => console.warn("见闻封面修复失败：", error instanceof Error ? error.message : error));
    void scheduleMemoryJobs({ store, provider, memory });
    stopDiaryScheduler = startDiaryScheduler(config.diaryCron, diary);
    stopJournalScheduler = startDailyJournalScheduler(config.journalCron, journal);
    void journal.resumeInterrupted();
    console.log(`WhalePartner API：http://${host}:${config.port}`);
    console.log(`旧视频日记计划：${config.diaryCron}（本机时区；API 运行时生效）`);
    console.log(`每日综合日记计划：${config.journalCron}（本机时区；API 运行时生效）`);
    console.log(`模型链：${provider.providers.map((item) => `${item.id}(${item.model})`).join(" → ")}`);
    if (lan) {
      console.log("已开放局域网访问：所有接口都需要令牌（Authorization: Bearer … 或 ?token=…）。");
      if (generatedToken) console.log(`本次临时令牌（未设置 WP_LOCAL_TOKEN）：${auth.localToken}`);
    } else if (auth.localToken) console.log("已启用 WP_LOCAL_TOKEN：所有接口都需要令牌。");
    if (existsSync(staticDir)) console.log(`网页端已托管：http://${host}:${config.port}/`);
    process.on("unhandledRejection", (reason) => console.warn("未处理的异步错误：", reason instanceof Error ? reason.message : reason));
  });
}
