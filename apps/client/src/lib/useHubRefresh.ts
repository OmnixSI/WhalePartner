import { useEffect, useRef } from "react";
import { subscribeHub, type HubEventType } from "./events";

/**
 * 其他设备（或后台任务）改了东西时，页面静默重拉一次。
 * 命中 `types` 里的事件，或 hub 说「该整体重拉了」（resync）时调用 `refresh`；短时间内多条合并成一次。
 */
export function useHubRefresh(types: readonly HubEventType[], refresh: () => void, delayMs = 300) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const key = types.join(",");

  useEffect(() => {
    const wanted = new Set<HubEventType>([...key.split(",") as HubEventType[], "resync"]);
    let timer: number | undefined;
    const off = subscribeHub((type) => {
      if (!wanted.has(type)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), delayMs);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [key, delayMs]);
}
