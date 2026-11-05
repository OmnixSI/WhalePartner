import { API_BASE } from "./api";

export interface JournalSource {
  id: string;
  type: "chat" | "video" | "web" | "learned" | "reflection";
  title: string;
  text: string;
  createdAt: string;
  sessionId?: string;
  messageId?: number;
  url?: string;
}

export interface DailyJournal {
  id: string;
  character: string;
  localDate: string;
  revision: number;
  text: string;
  sources: JournalSource[];
  modelId: string;
  createdAt: string;
}

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

export async function fetchJournals(character: string, signal?: AbortSignal): Promise<DailyJournal[]> {
  return (await request<{ items: DailyJournal[] }>(`/api/journals?character=${encodeURIComponent(character)}`, { signal })).items;
}

export async function generateJournal(character: string, date?: string, force = false): Promise<DailyJournal | null> {
  const result = await request<{ journal: DailyJournal | null; reason?: string }>("/api/journals/generate", {
    method: "POST",
    body: JSON.stringify({ character, ...(date ? { date } : {}), ...(force ? { force: true } : {}) }),
  });
  return result.journal;
}

export async function fetchJournalRevisions(id: string, signal?: AbortSignal): Promise<DailyJournal[]> {
  return (await request<{ revisions: DailyJournal[] }>(`/api/journals/${encodeURIComponent(id)}/revisions`, { signal })).revisions;
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
