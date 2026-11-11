import { rm } from "node:fs/promises";
import { splitEmotionTags } from "../chat/emotion.ts";
import { join } from "node:path";
import type { ChatProvider } from "../llm/types.ts";
import type { MemoryStore } from "../memory/types.ts";
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from "../persona/persona.ts";
import { containsBlocked, isBlockedHost, mergeBlocked } from "./blocklist.ts";
import { abortable, classifyError, SurfError, sleepAbortable, withRetry, type SurfErrorKind } from "./errors.ts";
import { SurfEventBus, type SurfItemEvent } from "./events.ts";
import { interestsOf } from "./interests.ts";
import { notifySurfItem } from "./notify.ts";
import {
  filterCandidates,
  filterWebResults,
  pickTopics,
  rankVideos,
  rankWebResults,
  siteOf,
  webDedupeKey,
  webDedupeKeys,
  webQueryFor,
  BV_KEY,
} from "./picker.ts";
import { contentFingerprint } from "./reader.ts";
import { FREQUENCY_PLAN, inQuietHours } from "./settings.ts";
import type { SurfRepository } from "./store.ts";
import { extractRecentTopics, pickVideo, pickWebs, summarizeItem, writeShareLine } from "./summary.ts";
import { mimeOfFile, type ThumbFetcher } from "./thumbs.ts";
import type {
  ItemSummary,
  SurfFeedItem,
  SurfFeedQuery,
  SurfItem,
  SurfQuotaProbe,
  SurfRunResult,
  SurfSessionRecord,
  SurfSettings,
  SurfSettingsPatch,
  SurfSkipReason,
  SurfStage,
  SurfStatus,
  VideoCandidate,
  VideoSource,
  WebPageText,
  WebSource,
} from "./types.ts";

/** 一次会话里每个条目占多少贝壳（B1 的额度表）。 */
export const SURF_COSTS = { video: 20, web: 3 } as const;
/** 会话总时长上限（等你聊完天的时间不算）。 */
export const SESSION_TIMEOUT_MS = 4 * 60_000;
/** 一次会话最多带回几样：宁可少而好。 */
export const MAX_ITEMS_PER_SESSION = 3;
/** 你聊完天之后，她再等这么久才继续逛。 */
export const CHAT_RESUME_MS = 2 * 60_000;
/** 等你聊完的时候，每隔多久看一眼。 */
const CHAT_POLL_MS = 5000;
/** 失败的槽位最多再试几次、两次之间至少隔多久。 */
export const SLOT_MAX_RETRIES = 2;
export const SLOT_RETRY_GAP_MS = 10 * 60_000;
/** 总结打分低于这个就不值得留（除非这趟只剩它）。 */
const MIN_WORTH = 2;
/** 手动触发的最小间隔。 */
export const MANUAL_COOLDOWN_MS = 30 * 60_000;
/** 分享频控：一天最多 2 次、间隔 ≥3 小时。 */
const SHARE_PER_DAY = 2;
const SHARE_GAP_MS = 3 * 60 * 60_000;
/** 连续 3 次 provider 失败后歇 1 小时。 */
const BACKOFF_FAILURES = 3;
const BACKOFF_MS = 60 * 60_000;
/** 选题缓存的时长。 */
const TOPIC_CACHE_MS = 6 * 60 * 60_000;
/** 两次导航之间的随机等待。 */
const NAV_GAP_MS: [number, number] = [1500, 4000];

export interface MessageSink {
  add(role: "user" | "assistant", content: string, emotion?: string | null, character?: string): { id: number };
}

export interface SurfServiceOptions {
  store: SurfRepository;
  provider: ChatProvider;
  memory?: MemoryStore;
  /** B 站搜索 + 看视频；没有就只逛网页。 */
  video?: VideoSource;
  /** 网页搜索 + 读完正文；没有就只看视频。 */
  web?: WebSource;
  thumbs?: ThumbFetcher;
  /** 往聊天里插分享消息（ChatStore）。 */
  messages?: MessageSink;
  /** 20:30 以后让她把今天逛到的写进日记。 */
  journal?: { trigger(): unknown };
  /** 额度探针（P-B 的 QuotaService 接进来之前可以没有）。 */
  quota?: SurfQuotaProbe;
  events?: SurfEventBus;
  /** 全局总闸（SURF_ENABLED）。 */
  enabled?: boolean;
  /** .local/surf：缩略图放在这里。 */
  dir?: string;
  now?: () => Date;
  /**
   * 你是不是正在聊天（含聊完后的 2 分钟缓冲，见 CHAT_RESUME_MS）。
   * 开始前为真就不出门；逛到一半为真就原地停下等，聊完 2 分钟后再继续。
   */
  isUserChatting?: () => boolean;
  /** 用户空闲了多少分钟（分享要求 ≥10）。 */
  userIdleMinutes?: () => number;
  timeoutMs?: number;
  /** 两次导航之间的等待（测试里置 0）。 */
  navGap?: () => number;
  /** 等你聊完时的轮询间隔（测试里调小）。 */
  chatPollMs?: number;
  /** 失败重试的退避基数（测试里置 0）。 */
  retryBaseMs?: number;
}

export type RunBlockCode = "too_soon" | "already_running" | "quota" | "disabled";

export interface RunCheck {
  ok: boolean;
  code?: RunBlockCode;
  message?: string;
}

interface SurfDraft {
  kind: "video" | "web";
  title: string;
  url: string;
  sourceSite: string;
  text: string;
  dedupeKey: string;
  fingerprint: string;
  imageUrl?: string;
  referer?: string;
}

interface RunningState {
  sessionId: number;
  stage: SurfStage;
  detail: string | null;
  waiting: boolean;
  controller: AbortController;
}

interface Failure {
  kind: SurfErrorKind;
  message: string;
}

const iso = (date: Date) => date.toISOString();

/** 当天零点（本地时区），用来算「今天」的计数。 */
export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/** 本地日期里的 `YYYY-MM-DD`。 */
export function localDateKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 今天某个槽位的时间点（本地）。 */
export function slotDate(now: Date, slot: string): Date {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(slot.slice(0, 2)), Number(slot.slice(3, 5)), 0, 0);
  return at;
}

const cleanMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 160);

/**
 * 总时长计时器：等你聊天的时间不算在内。
 * 暂停时清掉定时器并记下还剩多少，恢复时按剩余时间重新计。
 */
class SessionBudget {
  #remaining: number;
  #startedAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #onExpire: () => void;

  constructor(totalMs: number, onExpire: () => void) {
    this.#remaining = totalMs;
    this.#onExpire = onExpire;
    this.resume();
  }

  resume() {
    if (this.#timer) return;
    this.#startedAt = Date.now();
    this.#timer = setTimeout(this.#onExpire, Math.max(1, this.#remaining));
  }

  pause() {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#remaining = Math.max(1, this.#remaining - (Date.now() - this.#startedAt));
  }

  dispose() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/**
 * 「她自己去逛」的核心（§10.6.5）。所有真实网络调用都从 options 注入，测试用假实现；
 * 拿不到内容就把原因写进会话的 error，绝不编一条见闻出来。
 */
export class SurfService {
  readonly store: SurfRepository;
  readonly bus: SurfEventBus;
  readonly #options: SurfServiceOptions;
  #failures = 0;
  #backoffUntil: number | null = null;
  #stopped = false;
  readonly #topics = new Map<string, { at: number; topics: string[] }>();
  readonly #running = new Map<string, RunningState>();
  readonly #settled = new Set<Promise<unknown>>();

  constructor(options: SurfServiceOptions) {
    this.#options = options;
    this.store = options.store;
    this.bus = options.events ?? new SurfEventBus();
  }

  get webAvailable(): Promise<boolean> {
    return this.#webAvailable();
  }

  async #webAvailable(): Promise<boolean> {
    const web = this.#options.web;
    if (!web) return false;
    try {
      return await web.available();
    } catch {
      return false;
    }
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }

  get enabled(): boolean {
    return this.#options.enabled !== false && !this.#stopped;
  }

  get running(): boolean {
    return this.#running.size > 0;
  }

  /** 后端退出：不再接新会话，中止正在跑的，等它们收尾（最多等 5 秒）。 */
  async stop(): Promise<void> {
    this.#stopped = true;
    for (const state of this.#running.values()) state.controller.abort(new SurfError("aborted", "后端要退出了，她先回来。"));
    if (this.#settled.size > 0) {
      await Promise.race([Promise.allSettled([...this.#settled]), new Promise((resolve) => setTimeout(resolve, 5000).unref?.())]);
    }
  }

  // ---- 设置 ----

  settings(character: string): SurfSettings {
    return this.store.getSettings(character);
  }

  putSettings(character: string, patch: SurfSettingsPatch): SurfSettings {
    return this.store.putSettings(character, patch, iso(this.#now()));
  }

  // ---- 状态 ----

  async status(character: string): Promise<SurfStatus> {
    const now = this.#now();
    const settings = this.store.getSettings(character);
    const running = this.#running.get(character);
    const dayStart = iso(startOfLocalDay(now));
    const last = this.store.lastSession(character, ["done", "failed"]);
    let browser: SurfStatus["browser"] = null;
    try {
      browser = this.#options.web ? (this.#options.web.browserStatus?.() ?? { state: "ready", percent: 100, message: "" }) : null;
    } catch {
      browser = null;
    }
    return {
      running: Boolean(running),
      sessionId: running?.sessionId ?? null,
      stage: running?.stage ?? null,
      todayCount: this.store.countSince(character, "video", dayStart) + this.store.countSince(character, "web", dayStart),
      lastRunAt: last?.startedAt ?? null,
      nextRunAt: settings.enabled && this.enabled ? this.#nextSlot(settings, now) : null,
      pausedReason: this.#pausedReason(settings, now),
      webAvailable: await this.#webAvailable(),
      browser,
      detail: running?.detail ?? null,
      waiting: running?.waiting ?? false,
    };
  }

  #nextSlot(settings: SurfSettings, now: Date): string | null {
    const plan = FREQUENCY_PLAN[settings.frequency];
    for (const slot of plan.slots) {
      const at = slotDate(now, slot);
      if (at.getTime() > now.getTime() && !this.store.hasSession(settings.character, `${localDateKey(now)} ${slot}`)) {
        return iso(at);
      }
    }
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const first = plan.slots[0];
    if (!first) return null;
    return iso(slotDate(tomorrow, first));
  }

  #pausedReason(settings: SurfSettings, now: Date): SurfStatus["pausedReason"] {
    if (!this.enabled || !settings.enabled) return "disabled";
    if (this.#options.quota?.isLow()) return "quota";
    if (inQuietHours(settings.quiet, now)) return "quiet";
    return null;
  }

  // ---- 能不能跑 ----

  canRunNow(character: string, options: { manual?: boolean; now?: Date } = {}): RunCheck {
    const now = options.now ?? this.#now();
    const settings = this.store.getSettings(character);
    if (!this.enabled || !settings.enabled) return { ok: false, code: "disabled", message: "她现在不去逛了。" };
    if (this.#running.has(character)) return { ok: false, code: "already_running", message: "她已经在逛了。" };
    if (options.manual) {
      const since = iso(new Date(now.getTime() - MANUAL_COOLDOWN_MS));
      const lastManual = this.store.lastManualSession(character);
      if (lastManual && lastManual.startedAt >= since) {
        return { ok: false, code: "too_soon", message: "她刚回来不久，歇一会儿再去吧。" };
      }
    }
    if (this.#options.quota?.isLow()) return { ok: false, code: "quota", message: "这个月的贝壳快用完了，她先歇着。" };
    return { ok: true };
  }

  // ---- 会话 ----

  async run(
    character: CharacterId,
    options: { manual?: boolean; slot?: string; now?: Date; signal?: AbortSignal } = {},
  ): Promise<SurfRunResult> {
    const task = this.#run(character, options);
    this.#settled.add(task);
    void task.finally(() => this.#settled.delete(task)).catch(() => undefined);
    return task;
  }

  async #run(
    character: CharacterId,
    options: { manual?: boolean; slot?: string; now?: Date; signal?: AbortSignal } = {},
  ): Promise<SurfRunResult> {
    const now = options.now ?? this.#now();
    const manual = options.manual === true;
    const settings = this.store.getSettings(character);
    const check = this.canRunNow(character, { manual, now });
    if (!check.ok) {
      return { sessionId: null, state: "skipped", reason: check.code === "too_soon" ? null : (check.code as SurfSkipReason), items: 0, message: check.message };
    }
    if (!manual && inQuietHours(settings.quiet, now)) return this.#skip(character, options.slot, now, "quiet", "现在是安静时段。");
    if (this.#options.isUserChatting?.()) return this.#skip(character, options.slot, now, "chatting", "你在和她聊天，先不出去。");
    if (this.#backoffUntil && now.getTime() < this.#backoffUntil) return this.#skip(character, options.slot, now, "backoff", "刚才连着失败，她歇一会儿。");

    const plan = FREQUENCY_PLAN[settings.frequency];
    const dayStart = iso(startOfLocalDay(now));
    const videoLeft = Math.max(0, plan.videosPerDay - this.store.countSince(character, "video", dayStart));
    const webLeft = Math.max(0, plan.websPerDay - this.store.countSince(character, "web", dayStart));
    if (videoLeft === 0 && webLeft === 0) return this.#skip(character, options.slot, now, "daily_cap", "今天的名额用完了。");

    const slot = options.slot ?? (manual ? `manual-${iso(now)}` : `${localDateKey(now)} ${plan.slots[0]}`);
    const { session, created } = this.store.startSession(character, slot, iso(now));
    if (!created) {
      return { sessionId: session.id, state: "skipped", reason: null, items: 0, message: "这个时间点已经逛过了。" };
    }

    const controller = new AbortController();
    const state: RunningState = { sessionId: session.id, stage: "searching", detail: null, waiting: false, controller };
    this.#running.set(character, state);

    // 总时长只算她真的在逛的时间；你在聊天、她在等的时候计时暂停。
    const budget = new SessionBudget(this.#options.timeoutMs ?? SESSION_TIMEOUT_MS, () =>
      controller.abort(new SurfError("aborted", "逛太久，先回来了。")),
    );
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;

    const kinds: Array<"video" | "web"> = [];
    if (settings.video && this.#options.video && videoLeft > 0) kinds.push("video");
    if (settings.web && this.#options.web && webLeft > 0) kinds.push("web");

    const failures: Failure[] = [];
    const fail = (prefix: string, error: unknown) => {
      failures.push({ kind: classifyError(error, signal), message: `${prefix}：${cleanMessage(error)}` });
    };
    let items = 0;

    /** 你一开口，她就停下手里的事等着；聊完（外面算好的缓冲之后）再继续。 */
    const yieldToUser = async () => {
      if (!this.#options.isUserChatting?.()) return;
      budget.pause();
      state.waiting = true;
      this.#stage(character, state.stage, null, "你在聊天，她先等一会儿", true);
      try {
        while (this.#options.isUserChatting?.() && !signal.aborted) {
          await sleepAbortable(this.#options.chatPollMs ?? CHAT_POLL_MS, signal);
        }
      } finally {
        state.waiting = false;
        budget.resume();
      }
    };

    try {
      this.bus.publish(character, "session", { state: "start", sessionId: session.id, kinds });

      this.#stage(character, "searching", null, "在想今天看点什么");
      const topics = await this.#pickTopics(character, settings, signal);
      this.store.setQueries(session.id, topics);
      const blocked = mergeBlocked(settings.blocked);
      const recentTitles = this.store.recentTitles(character, 12);

      const drafts: SurfDraft[] = [];

      if (kinds.includes("video")) {
        await yieldToUser();
        this.#stage(character, "watching", "video", `搜：${topics.slice(0, 2).join("、")}`);
        try {
          const draft = await this.#browseVideo(character, topics, blocked, recentTitles, signal);
          if (draft) drafts.push(draft);
        } catch (error) {
          fail("视频", error);
        }
      }

      if (kinds.includes("web")) {
        const web = this.#options.web!;
        if (!(await this.#webAvailable())) {
          web.prepare?.();
          failures.push({ kind: "browser", message: "网页：这台机器上还没有能读网页的浏览器。" });
        } else {
          try {
            const room = Math.max(0, MAX_ITEMS_PER_SESSION - drafts.length);
            const webDrafts = await this.#browseWeb(character, settings, topics, blocked, recentTitles, Math.min(webLeft, room), signal, yieldToUser, (detail) =>
              this.#stage(character, "reading", "web", detail),
            );
            drafts.push(...webDrafts);
          } catch (error) {
            fail("网页", error);
          }
        }
      }

      // 总时长到了（不是后端在退出）而手里已经读到东西：给整理留 20 秒宽限，已经读到的不白读。
      let writeSignal = signal;
      if (signal.aborted) {
        if (drafts.length === 0 || this.#stopped || options.signal?.aborted) throw signal.reason ?? new SurfError("aborted", "逛太久，先回来了。");
        writeSignal = AbortSignal.timeout(20_000);
      } else {
        await yieldToUser();
      }
      this.#stage(character, "writing", null, drafts.length > 0 ? "在把看到的记下来" : null);
      const written = await this.#summarizeAll(character, drafts, blocked, writeSignal);
      for (const entry of written) {
        if (writeSignal.aborted) break;
        if (!signal.aborted) await yieldToUser();
        const item = await this.#write(character, session, entry.draft, entry.summary);
        if (!item) continue;
        items += 1;
        this.bus.publish(character, "item", this.#itemEvent(item));
        void notifySurfItem(this.store.feedItem(item));
      }

      // 一条都没产出也算没逛成：如实写进会话，别让界面以为她带回了东西。
      if (items === 0 && drafts.length > 0) failures.push({ kind: "provider", message: "总结失败，一条也没记下来" });
      if (items === 0 && drafts.length === 0 && failures.length === 0 && kinds.length > 0) failures.push({ kind: "content", message: "没找到合适的内容" });
      const status = items === 0 && failures.length > 0 ? "failed" : "done";
      const error = failures.length > 0 ? failures.map((entry) => entry.message).join("；").slice(0, 500) : null;
      this.store.finishSession(session.id, status, items, error, iso(this.#now()));

      if (status === "failed") this.#afterFailure(character, session.id, slot, manual, failures);
      else {
        this.#failures = 0;
        this.#backoffUntil = null;
      }

      if (items > 0) {
        await this.#afterSession(character, settings, session, signal);
      }

      this.bus.publish(character, "session", { state: "end", sessionId: session.id, kinds, count: items });
      return {
        sessionId: session.id,
        state: status === "failed" ? "failed" : "done",
        reason: null,
        items,
        message: error ?? undefined,
      };
    } catch (error) {
      const reason = signal.aborted ? (signal.reason instanceof Error ? signal.reason.message : "逛太久，先回来了。") : cleanMessage(error);
      this.store.finishSession(session.id, items > 0 ? "done" : "failed", items, reason, iso(this.#now()));
      if (!signal.aborted) this.#failures += 1;
      this.bus.publish(character, "session", { state: "end", sessionId: session.id, kinds, count: items });
      return { sessionId: session.id, state: "failed", reason: null, items, message: reason };
    } finally {
      budget.dispose();
      this.#running.delete(character);
    }
  }

  /** 整趟没带回东西之后：算不算连续失败、要不要让出槽位下次再试。 */
  #afterFailure(character: CharacterId, sessionId: number, slot: string, manual: boolean, failures: Failure[]) {
    // 浏览器没装好、被限流、页面本身打不开都不是「她坏了」，不计入 1 小时的全局退避。
    const countable = failures.some((entry) => entry.kind === "provider" || entry.kind === "unknown" || entry.kind === "network");
    if (countable) {
      this.#failures += 1;
      if (this.#failures >= BACKOFF_FAILURES) this.#backoffUntil = this.#now().getTime() + BACKOFF_MS;
    }
    // 纯网络原因失败：把槽位让出来，调度器在宽限期内隔几分钟再试，最多 2 次。
    const transient = failures.length > 0 && failures.every((entry) => entry.kind === "network");
    if (transient && !manual) {
      const base = slot.replace(/#retry\d+$/, "");
      const used = this.store.retriesForSlot(character, base);
      if (used < SLOT_MAX_RETRIES) this.store.releaseSlot(sessionId, base, used + 1);
    }
  }

  /** 不消耗槽位的跳过：每个 (槽位, 原因) 只留一行，下一个 tick 条件变了还能再来。 */
  #skip(character: string, slot: string | undefined, now: Date, reason: SurfSkipReason, message: string): SurfRunResult {
    const at = iso(now);
    const resolved = `skip-${reason}-${slot ?? at}`;
    const { session, created } = this.store.startSession(character, resolved, at);
    if (created) this.store.finishSession(session.id, "skipped", 0, reason, at);
    return { sessionId: session.id, state: "skipped", reason, items: 0, message };
  }

  #stage(character: string, stage: SurfStage, kind: "video" | "web" | null, detail: string | null = null, paused = false) {
    const state = this.#running.get(character);
    if (state) {
      state.stage = stage;
      state.detail = detail;
    }
    this.bus.publish(character, "step", { sessionId: state?.sessionId ?? 0, stage, kind, detail, paused });
  }

  async #pickTopics(character: CharacterId, settings: SurfSettings, signal: AbortSignal): Promise<string[]> {
    const blocked = mergeBlocked(settings.blocked);
    const now = this.#now();
    const cached = this.#topics.get(character);
    let recent: string[] = [];
    if (cached && now.getTime() - cached.at < TOPIC_CACHE_MS) {
      recent = cached.topics;
    } else {
      const since = iso(new Date(now.getTime() - 7 * 24 * 60 * 60_000));
      const messages = this.store.recentUserMessages(character, since, 40);
      recent = await extractRecentTopics(this.#options.provider, messages, this.store.recentFacts(10), signal);
      this.#topics.set(character, { at: now.getTime(), topics: recent });
    }
    return pickTopics({
      personaInterests: interestsOf(character),
      userInterests: settings.interests,
      recentTopics: recent,
      blocked,
      history: this.store.recentSessionTopics(character, 5),
    });
  }

  async #browseVideo(
    character: CharacterId,
    topics: string[],
    blocked: string[],
    recentTitles: string[],
    signal: AbortSignal,
  ): Promise<SurfDraft | null> {
    const source = this.#options.video;
    if (!source) return null;
    const seen = this.store.seenKeys(character);
    const candidates: VideoCandidate[] = [];
    let lastError: unknown = null;
    for (const topic of topics.slice(0, 2)) {
      if (signal.aborted) break;
      try {
        const found = await withRetry(() => abortable(source.search(topic), signal), { attempts: 2, baseMs: this.#options.retryBaseMs ?? 1200, signal });
        candidates.push(...found);
      } catch (error) {
        lastError = error;
        // 被限流了就别接着搜第二个词，让它冷却。
        if (classifyError(error, signal) === "rate_limit") break;
      }
      if (candidates.length >= 8) break;
    }
    if (candidates.length === 0 && lastError) throw lastError;
    const filtered = filterCandidates(candidates, { blocked, seen });
    if (filtered.length === 0) throw new SurfError("content", "没搜到合适的视频。");
    const ranked = rankVideos(filtered, { topics, recentTitles });
    const pick = await pickVideo(this.#options.provider, character, ranked, topics, signal, recentTitles);
    const chosen = ranked[pick.index] ?? ranked[0];
    this.#stage(character, "watching", "video", `在看《${chosen.title}》`);
    const watched = await withRetry(() => abortable(source.watch(chosen), signal), { attempts: 2, baseMs: this.#options.retryBaseMs ?? 1200, signal });
    const text = watched.text;
    const fingerprint = contentFingerprint(text);
    if (this.store.hasFingerprint(character, fingerprint)) throw new SurfError("content", "这个视频的内容以前看过了。");
    return {
      kind: "video",
      title: watched.title || chosen.title,
      url: watched.url || chosen.url,
      sourceSite: "bilibili",
      text,
      dedupeKey: BV_KEY(chosen.bvid),
      fingerprint,
      imageUrl: chosen.pic || undefined,
      referer: "https://www.bilibili.com",
    };
  }

  async #browseWeb(
    character: CharacterId,
    settings: SurfSettings,
    topics: string[],
    blocked: string[],
    recentTitles: string[],
    room: number,
    signal: AbortSignal,
    yieldToUser: () => Promise<void>,
    announce: (detail: string) => void,
  ): Promise<SurfDraft[]> {
    const source = this.#options.web;
    if (!source) return [];
    const plan = FREQUENCY_PLAN[settings.frequency];
    const quota = Math.max(0, Math.min(plan.websPerSession, room));
    if (quota === 0) return [];
    const dayStart = iso(startOfLocalDay(this.#now()));
    const seen = this.store.seenKeys(character);
    const hostCounts = this.store.hostCountsSince(character, dayStart);
    const drafts: SurfDraft[] = [];
    const picked = new Set<string>();
    const readFailures: Failure[] = [];
    let searchFailure: unknown = null;

    for (const topic of topics) {
      if (drafts.length >= quota || signal.aborted) break;
      await yieldToUser();
      announce(`搜：${topic}`);
      let results: Awaited<ReturnType<WebSource["search"]>> = [];
      try {
        results = await withRetry(() => abortable(source.search(webQueryFor(topic)), signal), { attempts: 2, baseMs: this.#options.retryBaseMs ?? 1000, signal });
      } catch (error) {
        searchFailure = error;
        if (classifyError(error, signal) === "rate_limit") break;
        continue;
      }
      // 先按标题和摘要打分，只把分数高的几条交给她挑，再去读。
      const usable = rankWebResults(
        filterWebResults(results, { blocked, seen, hostCounts }).filter((result) => !picked.has(result.url)),
        { topics: [topic, ...topics.filter((other) => other !== topic)].slice(0, 3), recentTitles },
        6,
      );
      if (usable.length === 0) continue;
      const indexes = await pickWebs(this.#options.provider, character, usable, topics, quota - drafts.length, signal, recentTitles);
      for (const index of indexes) {
        if (drafts.length >= quota || signal.aborted) break;
        const target = usable[index];
        if (!target || picked.has(target.url)) continue;
        picked.add(target.url);
        await yieldToUser();
        if (drafts.length > 0) await this.#pause(signal);
        announce(`在读《${target.title}》`);
        try {
          const page: WebPageText = await withRetry(() => abortable(source.read(target.url, { signal }), signal), {
            attempts: 2,
            baseMs: this.#options.retryBaseMs ?? 800,
            signal,
          });
          const site = (page.siteName || siteOf(page.url) || "").toLowerCase().replace(/^www\./, "");
          if (isBlockedHost(site) || isBlockedHost(siteOf(page.url))) continue;
          if (containsBlocked(page.text.slice(0, 500), blocked)) continue;
          // 读完才知道真实地址（可能被重定向）：再查一遍有没有看过，并比对正文指纹。
          if (webDedupeKeys(page.url).some((key) => seen.includes(key))) continue;
          const fingerprint = contentFingerprint(page.text);
          if (this.store.hasFingerprint(character, fingerprint)) continue;
          if (drafts.some((draft) => draft.fingerprint && draft.fingerprint === fingerprint)) continue;
          drafts.push({
            kind: "web",
            title: page.title || target.title,
            url: page.url,
            sourceSite: siteOf(page.url),
            text: page.text,
            dedupeKey: webDedupeKey(page.url),
            fingerprint,
            imageUrl: page.imageUrl,
          });
        } catch (error) {
          if (signal.aborted) break;
          const kind = classifyError(error, signal);
          readFailures.push({ kind, message: cleanMessage(error) });
          // 被限流：这一趟不再读了。浏览器没准备好：同理，别每页都撞一次。
          if (kind === "rate_limit" || kind === "browser") break;
          /* 单页读失败就跳过，不影响同一会话里的其它页 */
        }
      }
    }
    if (drafts.length === 0) {
      if (signal.aborted) throw signal.reason ?? new SurfError("aborted", "逛太久，先回来了。");
      if (searchFailure && readFailures.length === 0) throw searchFailure;
      const worst = readFailures.find((entry) => entry.kind === "rate_limit" || entry.kind === "browser") ?? readFailures[0];
      if (worst) throw new SurfError(worst.kind, `没读到能看懂的网页（${worst.message}）`);
      throw new SurfError("content", "没读到能看懂的网页。");
    }
    return drafts;
  }

  async #pause(signal: AbortSignal) {
    const gap = this.#options.navGap?.();
    if (gap !== undefined) {
      if (gap > 0) await sleepAbortable(gap, signal);
      return;
    }
    const wait = NAV_GAP_MS[0] + Math.floor(Math.random() * (NAV_GAP_MS[1] - NAV_GAP_MS[0]));
    await sleepAbortable(wait, signal);
  }

  /**
   * 先把读到的都总结一遍，再留下最值得带回来的 1–3 条：
   * 按「想讲给你听」的分数从高到低，低于门槛的不要（除非这趟只剩它一条）。
   */
  async #summarizeAll(
    character: CharacterId,
    drafts: SurfDraft[],
    blocked: string[],
    signal: AbortSignal,
  ): Promise<Array<{ draft: SurfDraft; summary: ItemSummary }>> {
    const summarized: Array<{ draft: SurfDraft; summary: ItemSummary }> = [];
    for (const draft of drafts) {
      if (signal.aborted) break;
      const summary = await summarizeItem(
        this.#options.provider,
        character,
        { kind: draft.kind, title: draft.title, sourceSite: draft.sourceSite, text: draft.text },
        blocked,
        signal,
      );
      if (summary) summarized.push({ draft, summary });
    }
    const ordered = summarized
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => b.entry.summary.worthSharing - a.entry.summary.worthSharing || a.index - b.index)
      .map((wrapped) => wrapped.entry);
    const good = ordered.filter((entry) => entry.summary.worthSharing >= MIN_WORTH);
    return (good.length > 0 ? good : ordered.slice(0, 1)).slice(0, MAX_ITEMS_PER_SESSION);
  }

  async #write(
    character: CharacterId,
    session: SurfSessionRecord,
    draft: SurfDraft,
    summary: ItemSummary,
  ): Promise<SurfItem | null> {
    const item = this.store.insertItem({
      character,
      sessionId: session.id,
      kind: draft.kind,
      title: draft.title.slice(0, 200),
      url: draft.url,
      sourceSite: draft.sourceSite,
      summary: summary.summary,
      comment: summary.comment,
      tags: summary.tags,
      score: summary.worthSharing,
      dedupeKey: draft.dedupeKey,
      createdAt: iso(this.#now()),
      thumbSourceUrl: draft.imageUrl ?? null,
      contentFp: draft.fingerprint,
    });
    if (!item) return null;

    const sourceId = `surf:${draft.dedupeKey}`;
    if (this.#options.memory) {
      try {
        const entry = await this.#options.memory.addExperience({
          kind: draft.kind,
          title: item.title,
          text: summary.summary,
          url: item.url,
          sourceId,
        });
        this.store.setExperience(item.id, entry.id);
      } catch (error) {
        console.warn("冲浪经历写入记忆失败：", cleanMessage(error));
      }
    }

    // 记账：视频 20、网页 3（kind 用 surf，P-B 汇总时并进「她自己逛」）。
    this.store.addLedger(character, "surf", draft.kind === "video" ? SURF_COSTS.video : SURF_COSTS.web, iso(this.#now()));

    if (draft.imageUrl && this.#options.thumbs) {
      const path = await this.#options.thumbs.fetch(draft.imageUrl, item.id, { referer: draft.referer }).catch(() => null);
      if (path) this.store.setThumb(item.id, path);
      else this.store.setThumbError(item.id, "封面下载失败");
    } else {
      this.store.setThumbError(item.id, "封面地址缺失");
    }
    return this.store.item(item.id) ?? item;
  }

  async #afterSession(character: CharacterId, settings: SurfSettings, session: SurfSessionRecord, signal: AbortSignal) {
    // 分享（§10.6.6）
    try {
      await this.maybeShare(character, settings, session, signal);
    } catch (error) {
      console.warn("冲浪分享失败：", cleanMessage(error));
    }
    // 20:30 之后重写今天的日记，让今天逛到的进日记。
    const now = this.#now();
    if (now.getHours() * 60 + now.getMinutes() >= 20 * 60 + 30 && this.#options.journal) {
      try {
        this.#options.journal.trigger();
      } catch (error) {
        console.warn("重写日记失败：", cleanMessage(error));
      }
    }
  }

  /** 值得分享就写一条带附件的助手消息；频控不满足就只进见闻页。 */
  async maybeShare(
    character: CharacterId,
    settings: SurfSettings,
    session: SurfSessionRecord,
    signal?: AbortSignal,
  ): Promise<{ itemId: number; messageId: number } | null> {
    if (!settings.shareToChat || !this.#options.messages) return null;
    const now = this.#now();
    if (inQuietHours(settings.quiet, now)) return null;
    if ((this.#options.userIdleMinutes?.() ?? Number.POSITIVE_INFINITY) < 10) return null;
    const dayStart = iso(startOfLocalDay(now));
    if (this.store.countSharedSince(character, dayStart) >= SHARE_PER_DAY) return null;
    const last = this.store.lastSharedAt(character);
    if (last && now.getTime() - Date.parse(last) < SHARE_GAP_MS) return null;

    const best = this.store.bestShareable(session.id);
    if (!best || best.score < 4) return null;

    const line = await writeShareLine(
      this.#options.provider,
      character,
      { title: best.title, sourceSite: best.sourceSite, summary: best.summary },
      signal,
    );
    if (!line) return null;
    // 主动分享也走一遍情绪剥离：标签不是正文，情绪要存进消息里给界面用。
    const { text: clean, emotions } = splitEmotionTags(line);
    const message = this.#options.messages.add("assistant", clean, emotions[0] ?? null, character);
    this.store.markShared(best.id, iso(now), message.id);
    this.bus.publish(character, "share", { itemId: best.id, messageId: message.id });
    return { itemId: best.id, messageId: message.id };
  }

  #itemEvent(item: SurfItem): SurfItemEvent {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      sourceSite: item.sourceSite,
      thumb: item.thumbPath ? `/api/surf/thumb/${item.id}` : null,
      thumbError: item.thumbError,
      comment: item.comment,
      createdAt: item.createdAt,
    };
  }

  // ---- 读接口 ----

  feed(query: SurfFeedQuery): { items: SurfFeedItem[]; total: number } {
    return this.store.feed(query);
  }

  item(id: number): SurfItem | undefined {
    return this.store.item(id);
  }

  /** 「忘掉」：软删除条目，同时删掉对应的记忆与缩略图（§10.6.10）。 */
  async forget(id: number): Promise<SurfItem | undefined> {
    const item = this.store.item(id);
    if (!item) return undefined;
    if (item.experienceId && this.#options.memory) {
      try {
        await this.#options.memory.remove(item.experienceId);
      } catch (error) {
        console.warn("删除见闻对应的记忆失败：", cleanMessage(error));
      }
    }
    if (item.thumbPath && this.#options.dir) {
      await rm(join(this.#options.dir, item.thumbPath), { force: true }).catch(() => undefined);
    }
    return this.store.hideItem(id);
  }

  thumbPath(id: number): { path: string; mime: string } | null {
    const item = this.store.item(id);
    if (!item?.thumbPath || !this.#options.dir) return null;
    return { path: join(this.#options.dir, item.thumbPath), mime: mimeOfFile(item.thumbPath) };
  }

  /** 聊天历史里这条助手消息对应的明信片（§10.6.6）。 */
  attachmentOf(messageId: number): Record<string, unknown> | undefined {
    const item = this.store.itemByMessage(messageId);
    if (!item) return undefined;
    return {
      type: "surf",
      itemId: item.id,
      kind: item.kind,
      title: item.title,
      url: item.url,
      thumb: item.thumbPath ? `/api/surf/thumb/${item.id}` : null,
      thumbError: item.thumbError,
      comment: item.comment,
    };
  }
}

/** 默认角色解析（和 routes/memories.ts 一样的口径）。 */
export function characterFrom(value: string | null): CharacterId {
  if (value && isCharacterId(value)) return value;
  return DEFAULT_CHARACTER;
}
