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
    for (const provider of this.#providers) {
      let started = false;
      try {
        for await (const delta of provider.stream(messages, options)) {
          if (delta.text) started = true;
          yield { ...delta, provider: provider.id };
        }
        return;
      } catch (error) {
        if (options.signal?.aborted || started) throw error;
        failures.push(`${provider.id}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`所有模型提供方都失败了。\n${failures.join("\n")}`);
  }
}
