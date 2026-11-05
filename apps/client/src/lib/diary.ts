import { API_BASE } from "./api";

export interface DiaryItem {
  id: number;
  inputUrl: string;
  bvid: string | null;
  title: string | null;
  sourceUrl: string | null;
  summary: string | null;
  diaryText: string | null;
  status: "pending" | "processing" | "failed" | "done" | "duplicate";
  errorStage: "video" | "diary" | null;
  error: string | null;
  memoryStatus: "pending" | "saved" | "failed" | null;
  memoryError: string | null;
  createdAt: string;
  processedAt: string | null;
  duplicateOf: number | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try { detail = ((await response.json()) as { error?: string }).error ?? detail; } catch { /* 非 JSON */ }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export async function fetchDiary(signal?: AbortSignal): Promise<DiaryItem[]> {
  return (await request<{ items: DiaryItem[] }>("/api/diary", { signal })).items;
}

export async function enqueueDiaryVideo(url: string): Promise<DiaryItem> {
  return (await request<{ item: DiaryItem }>("/api/diary/queue", { method: "POST", body: JSON.stringify({ url }) })).item;
}

export async function runDiaryQueue(): Promise<void> {
  await request<{ started: boolean }>("/api/diary/run", { method: "POST" });
}

export async function retryDiaryItem(id: number): Promise<void> {
  await request(`/api/diary/items/${id}/retry`, { method: "POST" });
}
