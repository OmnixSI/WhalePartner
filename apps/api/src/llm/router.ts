import type { ChatMessage, ChatProvider, LlmDelta, StreamOptions } from "./types.ts";

/**
 * 按顺序尝试多个提供方。一个提供方在输出任何文字之前失败，就换下一个；
 * 已经开始输出再失败，不能撤回已发出的内容，直接把错误抛给调用方。
 */
export class FallbackChatProvider implements ChatProvider {
  readonly #providers: ChatProvider[];

  constructor(providers: ChatProvider[]) {
    if (providers.length === 0) throw new Error("没有可用的模型提供方。");
    this.#providers = providers;
  }

  get id() {
    return this.#providers[0].id;
  }

  get model() {
    return this.#providers[0].model;
  }

  get providers(): ReadonlyArray<ChatProvider> {
    return this.#providers;
  }

  async *stream(messages: ChatMessage[], options: StreamOptions = {}): AsyncGenerator<LlmDelta> {
    const failures: string[] = [];
    const { firstTokenTimeoutMs, ...rest } = options;
    const share = firstTokenTimeoutMs ? Math.max(1, Math.floor(firstTokenTimeoutMs / this.#providers.length)) : undefined;
    for (const [index, provider] of this.#providers.entries()) {
      options.signal?.throwIfAborted();
      // 每条线路单独一个中止器：这一条迟迟不出字只中止它自己，不算调用方取消。
      const attempt = new AbortController();
      const forward = () => attempt.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", forward, { once: true });
      const last = index === this.#providers.length - 1;
      const budget = share && !last
        ? setTimeout(() => attempt.abort(new Error(`${provider.id} 超过 ${share} 毫秒没有回应`)), share)
        : undefined;
      let started = false;
      try {
        for await (const delta of provider.stream(messages, { ...rest, signal: attempt.signal })) {
          if (delta.text && !started) {
            started = true;
            clearTimeout(budget);
          }
          yield { ...delta, provider: provider.id };
        }
        return;
      } catch (error) {
        if (options.signal?.aborted || started) throw error;
        const reason = attempt.signal.aborted ? attempt.signal.reason : error;
        failures.push(`${provider.id}：${reason instanceof Error ? reason.message : String(reason)}`);
      } finally {
        clearTimeout(budget);
        options.signal?.removeEventListener("abort", forward);
      }
    }
    throw new Error(`所有模型提供方都失败了。\n${failures.join("\n")}`);
  }
}
