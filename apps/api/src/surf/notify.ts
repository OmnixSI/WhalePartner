import { publishEvent } from "../hub/events.ts";
import type { SurfFeedItem } from "./types.ts";

/** 实时通知：每条新见闻都通过 `publishEvent("surf.item", item)` 推给所有已连接的设备。 */
export async function notifySurfItem(item: SurfFeedItem): Promise<boolean> {
  try {
    publishEvent("surf.item", item);
    return true;
  } catch (error) {
    console.warn("冲浪实时通知失败：", error instanceof Error ? error.message : error);
    return false;
  }
}
