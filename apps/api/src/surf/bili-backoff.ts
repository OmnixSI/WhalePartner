import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { bilibiliBackoffPath } from "../data-dir.ts";
import { SurfError } from "./errors.ts";

/**
 * 冲浪这一侧对 B 站的指数退避。
 * B 站每次限流（412 / -352 / -799 / 429）都让冷却翻倍：10 分钟 → 20 → 40 … 最长 6 小时；
 * 一次成功就清零。状态写在数据目录里，重启后端也不会马上又去撞。
 * （视频摘要那条线自己的冷却文件是 bilibili.ts 的 bilibili-rate-limit.json，同样在数据目录。）
 */

export const BACKOFF_BASE_MS = 10 * 60_000;
export const BACKOFF_MAX_MS = 6 * 60 * 60_000;

interface BackoffState {
  failures: number;
  until: number;
  reason?: string;
}

export function backoffDelay(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
}

export interface BiliBackoffOptions {
  path?: () => string;
  now?: () => number;
}

export class BiliBackoff {
  readonly #path: () => string;
  readonly #now: () => number;

  constructor(options: BiliBackoffOptions = {}) {
    this.#path = options.path ?? bilibiliBackoffPath;
    this.#now = options.now ?? Date.now;
  }

  async #read(): Promise<BackoffState> {
    try {
      const parsed = JSON.parse(await readFile(this.#path(), "utf8")) as Partial<BackoffState>;
      return { failures: Number(parsed.failures) || 0, until: Number(parsed.until) || 0, reason: parsed.reason };
    } catch {
      return { failures: 0, until: 0 };
    }
  }

  /** 还在冷却就抛 rate_limit 错误；调用方据此跳过视频部分。 */
  async assertAllowed() {
    const state = await this.#read();
    if (state.until > this.#now()) {
      const minutes = Math.ceil((state.until - this.#now()) / 60_000);
      throw new SurfError("rate_limit", `B 站刚才限流了，冲浪这边再等 ${minutes} 分钟才会去搜。`);
    }
  }

  async recordFailure(reason: string): Promise<number> {
    const state = await this.#read();
    // 冷却期满后第一次再失败才继续翻倍；期内的并发失败不重复计。
    const failures = state.until > this.#now() ? state.failures : state.failures + 1;
    const jitter = 1 + (Math.random() - 0.5) * 0.2;
    const until = this.#now() + Math.round(backoffDelay(failures) * jitter);
    const path = this.#path();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({ failures, until, reason: reason.slice(0, 120) }, null, 2) + "\n", { mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
    return until;
  }

  async recordSuccess() {
    const state = await this.#read();
    if (state.failures > 0 || state.until > 0) await rm(this.#path(), { force: true });
  }
}
