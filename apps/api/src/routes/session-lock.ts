/** 每个会话一把互斥锁：同一会话同一时刻只有一轮在生成，后来的排队（可被取消）。 */
export class SessionMutex {
  readonly #tails = new Map<string, Promise<void>>();
  readonly #waiting = new Map<string, number>();

  isBusy(sessionId: string): boolean { return (this.#waiting.get(sessionId) ?? 0) > 0; }

  async acquire(sessionId: string, signal?: AbortSignal): Promise<() => void> {
    const previous = this.#tails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => mine);
    this.#tails.set(sessionId, tail);
    this.#waiting.set(sessionId, (this.#waiting.get(sessionId) ?? 0) + 1);
    let done = false;
    const free = () => {
      if (done) return;
      done = true;
      release();
      const left = (this.#waiting.get(sessionId) ?? 1) - 1;
      if (left <= 0) {
        this.#waiting.delete(sessionId);
        if (this.#tails.get(sessionId) === tail) this.#tails.delete(sessionId);
      } else this.#waiting.set(sessionId, left);
    };
    try {
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
        const onAbort = () => reject(signal?.reason ?? new Error("aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });
        previous.then(() => { signal?.removeEventListener("abort", onAbort); resolve(); });
      });
    } catch (error) {
      free();
      throw error;
    }
    return free;
  }
}

/** clientId 去重：最近的 500 条，保留 30 分钟。 */
export class ClientIdLedger {
  readonly #entries = new Map<string, { state: "running" | "done"; at: number; messageId?: number; userMessageId?: number; sessionId: string }>();

  #sweep() {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [key, value] of this.#entries) {
      if (value.at < cutoff || this.#entries.size > 500) this.#entries.delete(key);
      else break;
    }
  }

  get(clientId: string) { this.#sweep(); return this.#entries.get(clientId); }
  begin(clientId: string, sessionId: string) { this.#entries.set(clientId, { state: "running", at: Date.now(), sessionId }); }
  done(clientId: string, messageId: number, userMessageId?: number) {
    const entry = this.#entries.get(clientId);
    if (entry) Object.assign(entry, { state: "done", messageId, userMessageId, at: Date.now() });
  }
  /** 失败/中断：允许同一个 clientId 重试。 */
  forget(clientId: string) { this.#entries.delete(clientId); }
}
