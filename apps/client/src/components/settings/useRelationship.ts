/**
 * 好感度快照。设置页只在这里读，四个角色放在同一份状态里：
 * 顶部概览、「换一位」里的主卡和四张缩略卡都从这里取，不各读各的。
 *
 * 什么时候读（每个角色一个请求，同一角色只认最新一次，旧的被中止、晚到的响应也不算，见 lib/relationship-loader）：
 * - 进设置页：读当前角色；
 * - 「换一位」打开时（watchAll）：四个角色一起读，所以缩略卡和主卡等级一致；
 * - 弹窗开着时换角色：读新的当前角色，另外只补读还没读好的角色，不重读四个；
 * - 从别的窗口切回来：读当前（弹窗开着就四个一起）；
 * - 点「重试」：只重读读失败的角色（当前角色或任一缩略卡）。
 *
 * 重读期间留着旧值，读不到也不动旧值（它仍是最近一次读到的真实值），所以卡面不会闪成「读取中」；
 * 一个角色从没读到过才算 error，不编数字。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CHARACTERS, type CharacterId } from "../../characters";
import { fetchRelationship } from "../../lib/relationship";
import { createRelationshipLoader } from "../../lib/relationship-loader";
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
  const loader = useRef<ReturnType<typeof createRelationshipLoader<RelationshipProgress>> | null>(null);
  loader.current ??= createRelationshipLoader<RelationshipProgress>(fetchRelationship, {
    onReady: (id, snapshot) => setEntries((prev) => ({ ...prev, [id]: { snapshot, status: "ready" } })),
    onError: (id) => setEntries((prev) => (prev[id as CharacterId]?.snapshot ? prev : { ...prev, [id]: { snapshot: null, status: "error" } })),
  });
  const load = useCallback((ids: readonly CharacterId[]) => loader.current!.load(ids), []);

  // 进页面 / 换角色 / 打开弹窗时读；只是关弹窗不重读；弹窗开着换角色只读新的当前角色和还没读好的
  const last = useRef<{ id: CharacterId; all: boolean } | null>(null);
  useEffect(() => {
    const prev = last.current;
    last.current = { id: currentId, all: watchAll };
    if (prev && prev.id === currentId && prev.all && !watchAll) return;
    if (watchAll && prev?.all && prev.id !== currentId) {
      const notReady = ALL.filter((id) => id !== currentId && entriesRef.current[id]?.status !== "ready" && !loader.current!.pending(id));
      load([currentId, ...notReady]);
      return;
    }
    load(watchAll ? ALL : [currentId]);
  }, [currentId, watchAll, load]);

  useEffect(() => () => loader.current?.abortAll(), []);

  // 回到这个页面（切回窗口或标签）时再读一次，升档了设置页上的数字和卡面都跟着变
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") load(watchAll ? ALL : [currentId]); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [currentId, watchAll, load]);

  const retry = useCallback(() => {
    const failed = ALL.filter((id) => entriesRef.current[id]?.status === "error");
    if (!failed.length) return;
    setEntries((prev) => {
      const next = { ...prev };
      for (const id of failed) next[id] = LOADING;
      return next;
    });
    load(failed);
  }, [load]);

  return { ...(entries[currentId] ?? LOADING), entries, retry };
}
