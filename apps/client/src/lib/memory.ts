import { API_BASE } from "./api";

export interface MemoryEntry {
  id: string;
  text: string;
  kind: "fact" | "experience";
  createdAt?: string;
  source?: string;
  title?: string;
  url?: string;
  sourceId?: string;
  status?: "active" | "superseded";
  validFrom?: string;
  validTo?: string | null;
  sources?: Array<{ messageId: number; sessionId: string; createdAt: string; quote: string }>;
  vectorIndexed?: boolean;
  lastError?: string;
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

export interface CharacterNote {
  text: string;
  updatedAt: string;
}

export type MemoryCategory = "all" | "fact" | "conversation" | "video" | "web" | "diary" | "learned" | "reflection";

export interface MemoryExplorerItem {
  id: string;
  type: "fact" | "message" | "experience" | "reflection";
  category: Exclude<MemoryCategory, "all">;
  title: string;
  text: string;
  createdAt: string;
  character: string;
  role?: "user" | "assistant";
  sessionId?: string;
  sessionTitle?: string;
  messageId?: number;
  status?: "active" | "superseded";
  validFrom?: string;
  validTo?: string | null;
  sources?: Array<{ messageId: number; sessionId: string; character: string; createdAt: string; quote: string }>;
  sourceId?: string;
  url?: string;
  sourceMissing?: boolean;
}

export interface MemoryExplorerResult {
  items: MemoryExplorerItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<Exclude<MemoryCategory, "all">, number>;
}

export interface MemoryExplorerFilters {
  character: string;
  query?: string;
  category: MemoryCategory;
  status: "all" | "current" | "historical";
  role: "all" | "user" | "assistant";
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export async function fetchMemoryExplorer(filters: MemoryExplorerFilters, signal?: AbortSignal): Promise<MemoryExplorerResult> {
  const query = new URLSearchParams({
    character: filters.character,
    category: filters.category,
    status: filters.status,
    role: filters.role,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.query?.trim()) query.set("q", filters.query.trim());
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  const response = await fetch(`${API_BASE}/api/memories/explorer?${query}`, { signal });
  if (!response.ok) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try { detail = ((await response.json()) as { error?: string }).error ?? detail; } catch { /* 非 JSON */ }
    throw new Error(detail);
  }
  return (await response.json()) as MemoryExplorerResult;
}

/** 角色自己写的近况小记；还没写过就是 null。 */
export async function fetchNote(character: string, signal?: AbortSignal): Promise<CharacterNote | null> {
  try {
    const response = await fetch(`${API_BASE}/api/note?character=${encodeURIComponent(character)}`, { signal });
    if (!response.ok) return null;
    return ((await response.json()) as { note: CharacterNote | null }).note;
  } catch {
    return null;
  }
}
