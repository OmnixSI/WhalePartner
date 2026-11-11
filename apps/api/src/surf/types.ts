/** 「她自己去逛」的类型（规范 §10.6）。字段名与表列、SSE 事件一一对应。 */

export type SurfFrequency = "rare" | "normal" | "often";
export type SurfItemKind = "video" | "web";
export type SurfSessionStatus = "running" | "done" | "skipped" | "failed";
/** 会话被跳过的原因码（§10.6.5）。 */
export type SurfSkipReason = "disabled" | "quiet" | "quota" | "chatting" | "video_busy" | "backoff" | "daily_cap";
export type SurfStage = "searching" | "watching" | "reading" | "writing";

export interface SurfSettings {
  character: string;
  enabled: boolean;
  frequency: SurfFrequency;
  /** 用户补充的兴趣，≤8 个，每个 ≤12 字。 */
  interests: string[];
  /** 屏蔽词，≤20 个，每个 ≤12 字。 */
  blocked: string[];
  quiet: { start: string; end: string };
  video: boolean;
  web: boolean;
  shareToChat: boolean;
}

/** PUT 的请求体：上面字段的子集，quiet 允许 {start} 或 {end} 单独给。 */
export interface SurfSettingsPatch {
  enabled?: boolean;
  frequency?: SurfFrequency;
  interests?: string[];
  blocked?: string[];
  quiet?: { start?: string; end?: string };
  video?: boolean;
  web?: boolean;
  shareToChat?: boolean;
}

export interface SurfItem {
  id: number;
  character: string;
  sessionId: number;
  kind: SurfItemKind;
  title: string;
  url: string;
  sourceSite: string;
  thumbPath: string | null;
  thumbSourceUrl: string | null;
  thumbError: string | null;
  summary: string;
  comment: string;
  tags: string[];
  score: number;
  dedupeKey: string;
  /** 记忆库里那条经验的 id（mem0 给的是 UUID 字符串）。 */
  experienceId: string | null;
  createdAt: string;
  sharedAt: string | null;
  sharedMessageId: number | null;
  hidden: boolean;
}

/** 给客户端的条目形状（§10.6.10）：thumb 是接口路径，不是磁盘路径。 */
export interface SurfFeedItem {
  id: number;
  kind: SurfItemKind;
  title: string;
  url: string;
  sourceSite: string;
  thumb: string | null;
  thumbError: string | null;
  summary: string;
  comment: string;
  tags: string[];
  createdAt: string;
  sharedAt: string | null;
}

export interface SurfSessionRecord {
  id: number;
  character: string;
  slot: string;
  startedAt: string;
  finishedAt: string | null;
  status: SurfSessionStatus;
  itemsCount: number;
  error: string | null;
  queries: string[];
}

export interface SurfStatus {
  running: boolean;
  sessionId: number | null;
  stage: SurfStage | null;
  todayCount: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  pausedReason: "quota" | "quiet" | "disabled" | null;
  webAvailable: boolean;
  /** 渲染网页用的浏览器（自动安装在数据目录里）；没有网页源时是 null。 */
  browser: WebBrowserStatus | null;
  /** 当前一步的具体内容，例如「在读《鲸歌是什么》」；没在逛时是 null。 */
  detail: string | null;
  /** 因为你正在聊天，她先等着。 */
  waiting: boolean;
}

export interface SurfFeedQuery {
  character: string;
  kind?: SurfItemKind;
  page: number;
  pageSize: number;
  q?: string;
  /** 按来源筛：`bilibili` 或域名主体（`juejin.cn`）。 */
  site?: string;
  /** 只要这个时间（含）之后 / 之前（ISO）带回来的。 */
  from?: string;
  to?: string;
}

/** B 站搜索的一条候选（§10.6.8 A.1）。 */
export interface VideoCandidate {
  bvid: string;
  title: string;
  author: string;
  durationSeconds: number;
  play: number;
  description: string;
  pic: string;
  url: string;
}

/** 看过的视频：正文是她能读的材料（字幕/简介合成后的摘要）。 */
export interface WatchedVideo {
  bvid: string;
  title: string;
  url: string;
  text: string;
}

export interface VideoSource {
  search(keyword: string): Promise<VideoCandidate[]>;
  watch(candidate: VideoCandidate, options?: { signal?: AbortSignal }): Promise<WatchedVideo>;
}

/** 网页搜索的一条结果（§10.6.8 B.1）。 */
export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebPageText {
  url: string;
  title: string;
  text: string;
  siteName: string;
  imageUrl?: string;
}

export interface WebBrowserStatus {
  state: "idle" | "installing" | "ready" | "failed";
  /** 0–100；拿不到进度时是 null。 */
  percent: number | null;
  message: string;
}

export interface WebSource {
  search(keyword: string): Promise<WebResult[]>;
  read(url: string, options?: { signal?: AbortSignal }): Promise<WebPageText>;
  /** 渲染用的浏览器没装好时，后台开始安装（可选）。 */
  prepare?(): void;
  /** 浏览器安装进度（可选）。 */
  browserStatus?(): WebBrowserStatus;
  /** 无头浏览器可用与否；false 时网页部分整体跳过，状态里写 webAvailable:false。 */
  available(): boolean | Promise<boolean>;
}

/** 模型对一个条目的总结（§10.6.11）。 */
export interface ItemSummary {
  summary: string;
  comment: string;
  tags: string[];
  worthSharing: number;
  safe: boolean;
}

/** 一次会话的结果。 */
export interface SurfRunResult {
  sessionId: number | null;
  state: "done" | "skipped" | "failed";
  reason: SurfSkipReason | null;
  items: number;
  message?: string;
}

/** 额度探针：P-B 的 QuotaService 接进来之前，这里可以缺省。 */
export interface SurfQuotaProbe {
  isLow(): boolean;
  /** 扣不扣得动（剩余够不够）。 */
  canSpend(units: number): boolean;
}
