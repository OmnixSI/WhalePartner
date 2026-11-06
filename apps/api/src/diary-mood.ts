import type { ChatProvider } from "./llm/types.ts";
import { buildSystemPrompt, withUserName } from "./persona/persona.ts";

export const MOODS = ["happy", "calm", "tired", "excited", "sad", "cozy", "curious"] as const;
export type Mood = (typeof MOODS)[number];

export const WEATHERS = ["sunny", "cloudy", "rain", "night", "wind", "snow"] as const;
export type Weather = (typeof WEATHERS)[number];

export interface DiaryMeta {
  mood: Mood;
  weather: Weather;
  /** 日记小标题，最多 12 个字；模型没给就是 null，前端回退成日期。 */
  title: string | null;
}

/** 解析失败、枚举越界或调用失败的兜底值。 */
export const DEFAULT_DIARY_META: DiaryMeta = { mood: "calm", weather: "cloudy", title: null };

const MOOD_TASK = [
  '下面是你今天写的日记。请只输出一个 JSON：{"mood":"<happy|calm|tired|excited|sad|cozy|curious 之一>","weather":"<sunny|cloudy|rain|night|wind|snow 之一>","title":"<不超过 12 个字的日记小标题，用你自己的口吻，不要加标点结尾>"}。',
  "mood 选最贴近今天整体情绪的；weather 是你“心里的天气”，不是真实天气。不要输出任何别的文字。",
].join("\n");

function extractObject(raw: string): Record<string, unknown> | null {
  // 模型偶尔会加代码围栏或前后解释：从第一个 { 到最后 } 之间的部分当 JSON 试一次。
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 宽容解析：允许围栏、前后夹杂文字；mood/weather 越界就整体回退默认值。 */
export function parseDiaryMeta(raw: string): DiaryMeta {
  const parsed = extractObject(raw);
  if (!parsed) return { ...DEFAULT_DIARY_META };
  const mood = parsed.mood;
  const weather = parsed.weather;
  if (typeof mood !== "string" || !(MOODS as readonly string[]).includes(mood)) return { ...DEFAULT_DIARY_META };
  if (typeof weather !== "string" || !(WEATHERS as readonly string[]).includes(weather)) return { ...DEFAULT_DIARY_META };
  const rawTitle = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const title = rawTitle ? [...rawTitle].slice(0, 12).join("") : null;
  return { mood: mood as Mood, weather: weather as Weather, title };
}

export interface DiaryMetaOptions {
  nickname?: string | null;
  signal?: AbortSignal;
}

/**
 * 日记正文写完后紧接着的一次短调用（B3）：只问心情、心里的天气和小标题。
 * 解析不了就回退默认值；调用本身失败会抛错，由调用方决定是否用默认值兜底。
 */
export async function generateDiaryMeta(provider: ChatProvider, diaryText: string, options: DiaryMetaOptions = {}): Promise<DiaryMeta> {
  const system = `${withUserName(buildSystemPrompt(), options.nickname ?? null)}\n\n${MOOD_TASK}`;
  let raw = "";
  for await (const delta of provider.stream(
    [
      { role: "system", content: system },
      { role: "user", content: `<日记>\n${diaryText}\n</日记>` },
    ],
    { temperature: 0.2, maxTokens: 120, signal: options.signal },
  )) {
    if (delta.text) raw += delta.text;
  }
  return parseDiaryMeta(raw);
}
