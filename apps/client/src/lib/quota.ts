import { API_BASE } from "./api";

export type QuotaKind = "chat" | "video" | "web" | "journal" | "surf";

export const QUOTA_KIND_LABELS: Record<QuotaKind, string> = {
  chat: "聊天",
  video: "看视频",
  web: "读网页",
  journal: "写日记",
  surf: "她自己逛",
};

/** 402 时给用户看的话。 */
export const QUOTA_EXCEEDED_MESSAGE = "这个月的贝壳用完了，下个月 1 号再来找我。";

export interface QuotaPeriod {
  /** `YYYY-MM-DD`，服务器本地时区的月初。 */
  start: string;
  end: string;
  /** 下次刷新的时刻，带时区偏移。 */
  resetsAt: string;
}

export interface QuotaCosts {
  chat: number;
  video: number;
  web: number;
  journal: number;
  surfVideo: number;
  surfWeb: number;
}

export interface QuotaSummary {
  /** 目前恒为 "off"：还没开始收费。 */
  billing: "off";
  enforced: boolean;
  period: QuotaPeriod;
  total: number;
  used: number;
  remaining: number;
  /** 剩余不到两成时为 true。 */
  low: boolean;
  breakdown: Record<QuotaKind, number>;
  costs: QuotaCosts;
  today: { used: number };
}

/** 设置 › 额度用。服务没起来时返回 null，页面显示“未连接”。 */
export async function getQuota(signal?: AbortSignal): Promise<QuotaSummary | null> {
  try {
    const response = await fetch(`${API_BASE}/api/quota`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as QuotaSummary;
  } catch {
    return null;
  }
}

/** “下次刷新 12月1日”。 */
export function formatResetDate(period: QuotaPeriod): string {
  const [, month, day] = /^(\d{4})-(\d{2})-(\d{2})/.exec(period.resetsAt) ?? [];
  if (!month || !day) return period.resetsAt;
  return `${Number(month)}月${Number(day)}日`;
}
