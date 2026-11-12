/**
 * 当前角色的好感度快照。设置页只在这里读一次，顶部概览和「换一位」对话框共用，
 * 角色一换或点「重试」才重新读；读不到就是 error，不编数字。
 */
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";
import type { RelationshipProgress } from "../../card-preview/data";

export type RelationshipState = {
  snapshot: RelationshipProgress | null;
  status: "loading" | "ready" | "error";
  retry: () => void;
};

export function useRelationship(characterId: string): RelationshipState {
  const [loaded, setLoaded] = useState<{ characterId: string; snapshot: RelationshipProgress } | null>(null);
  const [status, setStatus] = useState<RelationshipState["status"]>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    setStatus("loading");
    void fetch(`${API_BASE}/api/relationship?character=${encodeURIComponent(characterId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as RelationshipProgress;
      })
      .then((snapshot) => {
        if (!Number.isFinite(snapshot.points) || !Number.isInteger(snapshot.level)) throw new Error("Invalid relationship snapshot");
        setLoaded({ characterId, snapshot });
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [characterId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { snapshot: loaded?.characterId === characterId ? loaded.snapshot : null, status, retry };
}
