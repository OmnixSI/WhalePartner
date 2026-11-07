import { CronJob } from "cron";
import { CHARACTERS, type CharacterId } from "../persona/persona.ts";
import { FREQUENCY_PLAN } from "./settings.ts";
import { localDateKey, slotDate, SLOT_RETRY_GAP_MS, type SurfService } from "./service.ts";

/** 槽位宽限：电脑睡一觉醒来，60 分钟内还补得上一趟（§10.6.4）。 */
export const SLOT_GRACE_MS = 60 * 60_000;
/** 只为最近 14 天有聊天记录的角色出去逛。 */
const ACTIVE_DAYS = 14;

export interface SurfSchedulerOptions {
  service: SurfService;
  /** 全局总闸（SURF_ENABLED）。关掉后 tick 直接返回，不产生任何会话。 */
  enabled?: () => boolean;
  /** 注入时间，测试用。 */
  now?: () => Date;
  characters?: readonly CharacterId[];
  onError?: (error: unknown) => void;
}

export interface TickResult {
  started: string[];
  skipped: Array<{ character: string; reason: string }>;
}

/**
 * 调度器（§10.6.4）：每 5 分钟看一眼有没有到点、又还没逛过的槽位。
 * 到点 → 先插一行 running（UNIQUE 保证同一槽位只跑一次）→ 顺序执行。
 */
export class SurfScheduler {
  #job: CronJob | null = null;
  readonly #options: SurfSchedulerOptions;

  constructor(options: SurfSchedulerOptions) {
    this.#options = options;
  }

  get characters(): readonly CharacterId[] {
    return this.#options.characters ?? (Object.keys(CHARACTERS) as CharacterId[]);
  }

  /** 现在到点的槽位（今天、在宽限窗口内、还没跑过）。 */
  dueSlot(character: CharacterId, now: Date): string | null {
    const settings = this.#options.service.store.getSettings(character);
    if (!settings.enabled) return null;
    const plan = FREQUENCY_PLAN[settings.frequency];
    for (const slot of plan.slots) {
      const at = slotDate(now, slot);
      const delta = now.getTime() - at.getTime();
      if (delta < 0 || delta > SLOT_GRACE_MS) continue;
      const key = `${localDateKey(now)} ${slot}`;
      if (this.#options.service.store.hasSession(character, key)) continue;
      // 上一次因为网络失败让出了槽位：隔一会儿再来，最多再试两次。
      const retries = this.#options.service.store.retriesForSlot(character, key);
      if (retries > 0) {
        const last = this.#options.service.store.sessionBySlot(character, `${key}#retry${retries}`);
        const finished = Date.parse(last?.finishedAt ?? last?.startedAt ?? "");
        if (Number.isFinite(finished) && now.getTime() - finished < SLOT_RETRY_GAP_MS) continue;
      }
      return slot;
    }
    return null;
  }

  async tick(now: Date = this.#options.now?.() ?? new Date()): Promise<TickResult> {
    const result: TickResult = { started: [], skipped: [] };
    if (this.#options.enabled?.() === false) return result;
    if (!this.#options.service.enabled) return result;

    for (const character of this.characters) {
      const slot = this.dueSlot(character, now);
      if (!slot) continue;
      const since = new Date(now.getTime() - ACTIVE_DAYS * 24 * 60 * 60_000).toISOString();
      if (!this.#options.service.store.hasRecentChat(character, since)) {
        result.skipped.push({ character, reason: "inactive" });
        continue;
      }
      try {
        const run = await this.#options.service.run(character, { manual: false, now, slot: `${localDateKey(now)} ${slot}` });
        if (run.state === "skipped") result.skipped.push({ character, reason: run.reason ?? "skipped" });
        else result.started.push(character);
      } catch (error) {
        this.#options.onError?.(error);
      }
    }
    return result;
  }

  /** 服务启动时挂上；返回停止函数。 */
  start(expression = "*/5 * * * *"): () => void {
    this.stop();
    this.#job = CronJob.from({
      cronTime: expression,
      onTick: () => {
        void this.tick();
      },
      start: true,
      waitForCompletion: true,
      name: "whalepartner-surf",
      errorHandler: (error) => this.#options.onError?.(error),
    });
    return () => {
      void this.#job?.stop();
      this.#job = null;
    };
  }

  get running(): boolean {
    return this.#job !== null;
  }

  stop() {
    void this.#job?.stop();
    this.#job = null;
  }
}
