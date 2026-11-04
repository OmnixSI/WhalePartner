import { API_BASE } from "./api";

export interface MemoryEntry {
  id: string;
  text: string;
  kind: "fact" | "experience";
  createdAt?: string;
  source?: string;
  title?: string;
  url?: string;
}

export async function fetchMemories(signal?: AbortSignal): Promise<MemoryEntry[]> {
  const response = await fetch(`${API_BASE}/api/memories`, { signal });
  if (!response.ok) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try { detail = ((await response.json()) as { error?: string }).error ?? detail; } catch { /* 非 JSON */ }
    throw new Error(detail);
  }
  return ((await response.json()) as { entries: MemoryEntry[] }).entries;
}

export async function deleteMemory(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`删除失败（HTTP ${response.status}）`);
}
