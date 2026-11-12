/**
 * 好感度快照。设置页只在这里读，四个角色放在同一份状态里：
 * 顶部概览、「换一位」里的主卡和四张缩略卡都从这里取，不各读各的。
 *
 * 什么时候读（每个角色一个请求，同一角色的新请求会作废上一个）：
 * - 进设置页：读当前角色；
 * - 「换一位」打开时（watchAll）：四个角色一起读，所以缩略卡和主卡等级一致；
 * - 换角色、从别的窗口切回来：读当前（弹窗开着就四个一起）；
 * - 点「重试」：把读失败的角色重读（至少含当前角色）。
 *
 * 重读期间留着旧值，读不到也不动旧值（它仍是最近一次读到的真实值），所以卡面不会闪成「读取中」；
 * 一个角色从没读到过才算 error，不编数字。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CHARACTERS, type CharacterId } from "../../characters";
import { fetchRelationship } from "../../lib/relationship";
import type { RelationshipProgress } from "../../card-preview/data";

export type RelationshipEntry = {
  snapshot: RelationshipProgress | null;
  status: "loading" | "ready" | "error";
};

export type RelationshipState = RelationshipEntry & {
  /** 四个角色各自的快照；还没请求过的角色不在里面（按 loading 处理） */
  entries: Partial<Record<CharacterId, RelationshipEntry>>;
  retry: () => void;
};

const LOADING: RelationshipEntry = { snapshot: null, status: "loading" };
const ALL: readonly CharacterId[] = CHARACTERS.map((c) => c.id);

export function useRelationship(currentId: CharacterId, watchAll: boolean): RelationshipState {
  const [entries, setEntries] = useState<Partial<Record<CharacterId, RelationshipEntry>>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const controllers = useRef(new Map<CharacterId, AbortController>());

  const load = useCallback((ids: readonly CharacterId[]) => {
    for (const id of ids) {
      controllers.current.get(id)?.abort();
      const controller = new AbortController();
      controllers.current.set(id, controller);
      fetchRelationship(id, controller.signal)
        .then((snapshot) => setEntries((prev) => ({ ...prev, [id]: { snapshot, status: "ready" } })))
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
          setEntries((prev) => (prev[id]?.snapshot ? prev : { ...prev, [id]: { snapshot: null, status: "error" } }));
        });
    }
  }, []);

  // 进页面 / 换角色 / 打开弹窗时读；只是关弹窗不重读
  const last = useRef<{ id: CharacterId; all: boolean } | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = { id: currentId, all: watchAll };
    if (prev && prev.id === currentId && prev.all && !watchAll) return;
    load(watchAll ? ALL : [currentId]);
  }, [currentId, watchAll, load]);

  useEffect(() => () => { for (const c of controllers.current.values()) c.abort(); }, []);

  // 回到这个页面（切回窗口或标签）时再读一次，升档了设置页上的数字和卡面都跟着变
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") load(watchAll ? ALL : [currentId]); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [currentId, watchAll, load]);

  const retry = useCallback(() => {
    const failed = ALL.filter((id) => entriesRef.current[id]?.status === "error" || id === currentId);
    setEntries((prev) => {
      const next = { ...prev };
      for (const id of failed) if (!next[id]?.snapshot) next[id] = LOADING;
      return next;
    });
    load(failed);
  }, [currentId, load]);

  return { ...(entries[currentId] ?? LOADING), entries, retry };
}
