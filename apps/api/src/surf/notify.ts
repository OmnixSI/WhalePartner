import type { SurfFeedItem } from "./types.ts";

/**
 * 实时通知的薄适配：每条新见闻都通过 `publishEvent("surf.item", item)` 推给所有设备。
 * 事件总线在 ../events.ts（聊天那条线负责实现）。这里动态 import：
 * 模块在就调用，不在（比如本分支单独编译/测试）就什么也不做，保证两边互不阻塞。
 */

type Publish = (name: string, payload: unknown) => unknown;

let loading: Promise<Publish | null> | null = null;

async function load(): Promise<Publish | null> {
  // 用变量做模块名，避免 TypeScript 在 events.ts 还不存在时报找不到模块。
  const specifier = "../events.ts";
  try {
    const mod = (await import(specifier)) as { publishEvent?: Publish };
    return typeof mod.publishEvent === "function" ? mod.publishEvent : null;
  } catch {
    return null;
  }
}

/** 测试里重置缓存用。 */
export function resetNotifyCache() {
  loading = null;
}

export async function notifySurfItem(item: SurfFeedItem): Promise<boolean> {
  loading ??= load();
  const publish = await loading;
  if (!publish) return false;
  try {
    await publish("surf.item", item);
    return true;
  } catch (error) {
    console.warn("冲浪实时通知失败：", error instanceof Error ? error.message : error);
    return false;
  }
}
