import type { ApiConfig } from "../server/config.ts";
import type { ChatProvider } from "../llm/types.ts";
import type { MemoryStore } from "../memory/types.ts";
import { createBilibiliVideoSource } from "./bilibili-source.ts";
import { closeSharedBrowser } from "./browser.ts";
import { createPageReader } from "./page-reader.ts";
import { SurfEventBus } from "./events.ts";
import { SurfScheduler } from "./scheduler.ts";
import { SurfService, type MessageSink } from "./service.ts";
import { SurfRepository } from "./store.ts";
import { repairMissingThumbnails, thumbFetcher, type ThumbFetcher } from "./thumbs.ts";
import type { SurfQuotaProbe, VideoSource, WebSource } from "./types.ts";
import { createWebSource } from "./web-search.ts";

export { SurfRepository } from "./store.ts";
export { SurfService, SURF_COSTS, MANUAL_COOLDOWN_MS, CHAT_RESUME_MS, SESSION_TIMEOUT_MS, MAX_ITEMS_PER_SESSION } from "./service.ts";
export { SurfScheduler } from "./scheduler.ts";
export { SurfEventBus } from "./events.ts";
export type { MessageSink } from "./service.ts";
export { notifySurfItem } from "./notify.ts";

/** 已经装起来的冲浪实例。`stopSurf()` 一次性全部收掉。 */
const wirings = new Set<SurfWiring>();

/**
 * 停掉冲浪的一切：调度器、正在跑的会话、共享的 Chromium。
 * 后端关闭时调用（pack Agent 在退出流程里会调它）；重复调用安全，没启动过也安全。
 */
export async function stopSurf(): Promise<void> {
  const current = [...wirings];
  wirings.clear();
  for (const wiring of current) wiring.scheduler.stop();
  await Promise.allSettled(current.map((wiring) => wiring.service.stop()));
  await closeSharedBrowser();
}

export interface SurfOptions {
  dbPath: string;
  config: ApiConfig;
  provider: ChatProvider;
  memory?: MemoryStore;
  messages?: MessageSink;
  journal?: { trigger(): unknown };
  quota?: SurfQuotaProbe;
  /** 测试注入用：换成假实现。 */
  video?: VideoSource;
  web?: WebSource;
  thumbs?: ThumbFetcher;
  events?: SurfEventBus;
  now?: () => Date;
  isUserChatting?: () => boolean;
  userIdleMinutes?: () => number;
  navGap?: () => number;
  dir?: string;
}

export interface SurfWiring {
  store: SurfRepository;
  service: SurfService;
  scheduler: SurfScheduler;
  repairMissingThumbnails(): Promise<void>;
  /** 服务入口调用：挂上调度器，返回停止函数。 */
  start(expression?: string): () => void;
  /** 停调度器、中止会话（浏览器由 stopSurf 统一关）。 */
  stop(): Promise<void>;
}

/**
 * 把「她自己去逛」装起来（§10.6）：一个 SQLite 仓库、一条事件总线、一套真实数据源，
 * 再加一个每 5 分钟看一眼的调度器。真实数据源全部按需注入，测试换成假实现。
 */
export function createSurf(options: SurfOptions): SurfWiring {
  const dir = options.dir ?? options.config.surfDir;
  const store = new SurfRepository(options.dbPath);
  const events = options.events ?? new SurfEventBus();
  const thumbs = options.thumbs ?? thumbFetcher(dir);

  const video =
    options.video ?? (options.config.surfEnabled ? createBilibiliVideoSource() : undefined);
  const web =
    options.web ??
    (options.config.surfEnabled
      ? createWebSource({ reader: createPageReader({ chromiumPath: options.config.surfChromiumPath }) })
      : undefined);

  const service = new SurfService({
    store,
    provider: options.provider,
    memory: options.memory,
    video,
    web,
    thumbs,
    messages: options.messages,
    journal: options.journal,
    quota: options.quota,
    events,
    enabled: options.config.surfEnabled,
    dir,
    now: options.now,
    isUserChatting: options.isUserChatting,
    userIdleMinutes: options.userIdleMinutes,
    navGap: options.navGap,
  });

  const scheduler = new SurfScheduler({
    service,
    enabled: () => options.config.surfEnabled,
    now: options.now,
    onError: (error) => console.warn("冲浪调度失败：", error instanceof Error ? error.message : error),
  });

  const wiring: SurfWiring = {
    store,
    service,
    scheduler,
    repairMissingThumbnails: () => repairMissingThumbnails(store, thumbs, dir),
    start(expression?: string) {
      wirings.add(wiring);
      const stopScheduler = scheduler.start(expression);
      // 开着冲浪又没装浏览器：稍等一下（别和启动抢资源）就在后台装好，第一次逛网页时就用得上。
      if (web && options.config.surfEnabled && !options.web) {
        const timer = setTimeout(() => web.prepare?.(), 20_000);
        timer.unref?.();
      }
      return () => {
        stopScheduler();
      };
    },
    async stop() {
      scheduler.stop();
      await service.stop();
    },
  };
  return wiring;
}
