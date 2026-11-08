import type { ApiConfig } from "./config.ts";
import type { FallbackChatProvider } from "./llm/router.ts";
import type { MemoryStatus, MemoryStore } from "./memory/types.ts";
import type { AccountService } from "./accounts.ts";
import type { DiaryService } from "./diary-service.ts";
import type { VideoService } from "./video-service.ts";
import type { WebService } from "./web-service.ts";
import type { ChatStore } from "./store.ts";
import type { DailyJournalService } from "./daily-journal.ts";
import type { SurfService } from "./surf/service.ts";
import type { AuthOptions } from "./auth.ts";
import type { EventBus } from "./events.ts";
import type { AsrService } from "./voice/asr.ts";
import type { TtsService } from "./voice/tts.ts";

/** 模型接入（设置 › 模型接入）：要读写的两个文件，测试时注入临时路径。 */
export interface SetupPaths {
  /** 写 `DEEPSEEK_API_KEY` 的 `.env`；不传就用 `apps/api/.env`。 */
  envPath?: string;
  /** Codex 的 `config.toml`；不传就用 `~/.codex/config.toml`。 */
  codexPath?: string;
}

export interface ServerDeps {
  config: ApiConfig;
  provider: FallbackChatProvider;
  store: ChatStore;
  memory?: MemoryStore & { status?(): MemoryStatus };
  /** 提供后聊天里的 B 站链接会被看完，并开放 /api/videos/summarize。 */
  video?: VideoService;
  /** 日记和待看队列；定时器只在服务进程入口启动。 */
  diary?: DiaryService;
  /** 按共享日期生成、由当前人格执笔的综合日记。 */
  journal?: DailyJournalService;
  /** 提供后聊天里的普通网页链接会被读完再聊。 */
  web?: WebService;
  /** 各平台账号接入（目前只有 B 站）。 */
  accounts?: AccountService;
  /** 「她自己去逛」：见闻、设置、调度、SSE。 */
  surf?: SurfService;
  /** 鉴权配置。省略 = 开发便利模式（仅本机回环免 token，仍校验 Origin / Host）。 */
  auth?: AuthOptions;
  /** 实时事件总线；省略用进程单例。 */
  events?: EventBus;
  /** 静态托管的前端目录（apps/client/dist）。 */
  staticDir?: string;
  /** 模型接入要写的两个文件；只有测试会传，正常启动走默认路径。 */
  setup?: SetupPaths;
  /** 本地语音识别；测试可以注入固定实现。 */
  asr?: AsrService;
  /** 本地流式语音合成；测试可以注入固定实现。 */
  tts?: TtsService;
}
