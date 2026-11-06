/** Tauri 窗口里页面来自 tauri://，需要直连本机服务；浏览器开发时走 Vite 代理（同源）。 */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  ("__TAURI_INTERNALS__" in window ? "http://127.0.0.1:8787" : "");

export interface Health {
  ok: boolean;
  provider?: string;
  model?: string;
  /** B6.1：日记计划时间；没接日记任务时后端不带这一项。 */
  schedule?: { journalTime: string | null };
}

/** 后端状态探测。A2 之前服务不存在时返回 null，界面显示“未连接”。 */
export async function fetchHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}
