export interface Health {
  ok: boolean;
  provider?: string;
  model?: string;
}

/** 后端状态探测。A2 之前服务不存在时返回 null，界面显示“未连接”。 */
export async function fetchHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    const res = await fetch("/api/health", { signal });
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}
