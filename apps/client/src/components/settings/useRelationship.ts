/**
 * 当前角色的好感度快照。设置页只在这里读一次，顶部概览和「换一位」对话框共用；
 * 角色一换或点「重试」才从头重读；读不到就是 error，不编数字。
 *
 * refresh() 是静默重读：打开「换一位」、从别的窗口切回来时调用。重读期间留着旧值，
 * 读不到也不改状态（旧值仍然是最近一次读到的真实值），这样卡面不会闪成「读取中」。
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";
import type { RelationshipProgress } from "../../card-preview/data";

export type RelationshipState = {
  snapshot: RelationshipProgress | null;
  status: "loading" | "ready" | "error";
  retry: () => void;
  refresh: () => void;
};

async function fetchRelationship(characterId: string, signal: AbortSignal): Promise<RelationshipProgress> {
  const response = await fetch(`${API_BASE}/api/relationship?character=${encodeURIComponent(characterId)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const snapshot = (await response.json()) as RelationshipProgress;
  if (!Number.isFinite(snapshot.points) || !Number.isInteger(snapshot.level)) throw new Error("Invalid relationship snapshot");
  return snapshot;
}

export function useRelationship(characterId: string): RelationshipState {
  const [loaded, setLoaded] = useState<{ characterId: string; snapshot: RelationshipProgress } | null>(null);
  const [status, setStatus] = useState<RelationshipState["status"]>("loading");
  const [attempt, setAttempt] = useState(0);
  const [refreshRev, setRefreshRev] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    setStatus("loading");
    fetchRelationship(characterId, controller.signal)
      .then((snapshot) => {
        setLoaded({ characterId, snapshot });
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [characterId, attempt]);

  // 静默重读：成功就换新值，失败不动。角色换了、或又点了一次，上一次的结果作废。
  useEffect(() => {
    if (refreshRev === 0) return;
    const controller = new AbortController();
    fetchRelationship(characterId, controller.signal)
      .then((snapshot) => {
        setLoaded({ characterId, snapshot });
        setStatus("ready");
      })
      .catch(() => { /* 保留旧值 */ });
    return () => controller.abort();
  }, [characterId, refreshRev]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const refresh = useCallback(() => setRefreshRev((n) => n + 1), []);

  // 回到这个页面（切回窗口或标签）时再读一次，升档了设置页上的数字和卡面都跟着变
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { snapshot: loaded?.characterId === characterId ? loaded.snapshot : null, status, retry, refresh };
}
