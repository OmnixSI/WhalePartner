import type { ApiConfig } from "./config.ts";
import type { FallbackChatProvider } from "./llm/router.ts";
import type { MemoryStatus, MemoryStore } from "./memory/types.ts";
import type { AccountService } from "./accounts.ts";
import type { DiaryService } from "./diary-service.ts";
import type { VideoService } from "./video-service.ts";
import type { WebService } from "./web-service.ts";
import type { ChatStore } from "./store.ts";
import type { DailyJournalService } from "./daily-journal.ts";

export interface ServerDeps {
  config: ApiConfig;
  provider: FallbackChatProvider;
  store: ChatStore;
  memory?: MemoryStore & { status?(): MemoryStatus };
  /** 提供后聊天里的 B 站链接会被看完，并开放 /api/videos/summarize。 */
  video?: VideoService;
  /** 日记和待看队列；定时器只在服务进程入口启动。 */
  diary?: DiaryService;
  /** 按角色和本地日期生成的综合日记。 */
  journal?: DailyJournalService;
  /** 提供后聊天里的普通网页链接会被读完再聊。 */
  web?: WebService;
  /** 各平台账号接入（目前只有 B 站）。 */
  accounts?: AccountService;
}
