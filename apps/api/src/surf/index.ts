import type { ApiConfig } from "../config.ts";
import type { ChatProvider } from "../llm/types.ts";
import type { MemoryStore } from "../memory/types.ts";
import { createBilibiliVideoSource } from "./bilibili-source.ts";
import { createBrowserReader } from "./browser.ts";
import { SurfEventBus } from "./events.ts";
import { SurfScheduler } from "./scheduler.ts";
import { SurfService, type MessageSink } from "./service.ts";
import { SurfRepository } from "./store.ts";
import { repairMissingThumbnails, thumbFetcher, type ThumbFetcher } from "./thumbs.ts";
import type { SurfQuotaProbe, VideoSource, WebSource } from "./types.ts";
import { createWebSource } from "./web-search.ts";

export { SurfRepository } from "./store.ts";
export { SurfService, SURF_COSTS, MANUAL_COOLDOWN_MS } from "./service.ts";
export { SurfScheduler } from "./scheduler.ts";
export { SurfEventBus } from "./events.ts";
export type { MessageSink } from "./service.ts";

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
      ? createWebSource({ reader: createBrowserReader({ chromiumPath: options.config.surfChromiumPath }) })
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

  return {
    store,
    service,
    scheduler,
    repairMissingThumbnails: () => repairMissingThumbnails(store, thumbs, dir),
    start(expression?: string) {
      return scheduler.start(expression);
    },
  };
}
