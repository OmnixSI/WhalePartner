import { API_BASE } from "./api";
import type { RelationshipProgress } from "../card-preview/data";

/** GET /api/relationship?character=…：读不到或数据不合法就抛错，不编数字。 */
export async function fetchRelationship(characterId: string, signal?: AbortSignal): Promise<RelationshipProgress> {
  const response = await fetch(`${API_BASE}/api/relationship?character=${encodeURIComponent(characterId)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const snapshot = (await response.json()) as RelationshipProgress;
  if (!Number.isFinite(snapshot.points) || !Number.isInteger(snapshot.level)) throw new Error("Invalid relationship snapshot");
  return snapshot;
}
