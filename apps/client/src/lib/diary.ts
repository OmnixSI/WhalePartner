import { API_BASE } from "./api";

/** B3：她这一天的心情。 */
export type DiaryMood = "happy" | "calm" | "tired" | "excited" | "sad" | "cozy" | "curious";
/** B3：她“心里的天气”，不是真实天气。 */
export type DiaryWeather = "sunny" | "cloudy" | "rain" | "night" | "wind" | "snow";

export const MOOD_LABELS: Record<DiaryMood, string> = {
  happy: "开心",
  calm: "平静",
  tired: "有点累",
  excited: "兴奋",
  sad: "有点难过",
  cozy: "暖洋洋",
  curious: "好奇",
};

/** 天气 → 界面涂鸦。 */
export const WEATHER_DOODLES: Record<DiaryWeather, "sun" | "cloud" | "rain" | "moon" | "wave" | "star"> = {
  sunny: "sun",
  cloudy: "cloud",
  rain: "rain",
  night: "moon",
  wind: "wave",
  snow: "star",
};

export interface DiaryItem {
  id: number;
  inputUrl: string;
  bvid: string | null;
  title: string | null;
  sourceUrl: string | null;
  summary: string | null;
  diaryText: string | null;
  /** B3；旧数据或还没生成时是 null（界面不画涂鸦）。 */
  mood: DiaryMood | null;
  weather: DiaryWeather | null;
  /** 日记小标题，最多 12 个字；null 时标题回退成日期。 */
  diaryTitle: string | null;
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
