/**
 * 按角色读好感度，同一角色只认最新一次请求：新请求发出时上一个会被中止，
 * 而且上一个就算已经拿到响应（abort 拦不住 .then 之前那一小段），也不能写回去覆盖新的结果。
 * 不依赖 React，方便单测；useRelationship 把它的回调接到 state 上。
 */
export type RelationshipLoaderHandlers<T> = {
  onReady: (id: string, value: T) => void;
  onError: (id: string, error: unknown) => void;
};

export function createRelationshipLoader<T>(fetcher: (id: string, signal: AbortSignal) => Promise<T>, handlers: RelationshipLoaderHandlers<T>) {
  const controllers = new Map<string, AbortController>();
  const current = (id: string, controller: AbortController) => !controller.signal.aborted && controllers.get(id) === controller;

  return {
    load(ids: readonly string[]) {
      for (const id of ids) {
        controllers.get(id)?.abort();
        const controller = new AbortController();
        controllers.set(id, controller);
        fetcher(id, controller.signal).then(
          (value) => {
            if (!current(id, controller)) return;
            controllers.delete(id);
            handlers.onReady(id, value);
          },
          (error: unknown) => {
            if (!current(id, controller)) return;
            controllers.delete(id);
            handlers.onError(id, error);
          },
        );
      }
    },
    /** 这个角色是不是还有请求在路上 */
    pending: (id: string) => controllers.has(id),
    abortAll() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    },
  };
}
