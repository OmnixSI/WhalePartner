import { API_BASE } from "./api";

export interface ExportResult {
  ok: true;
  /** 导出文件在本机的完整路径（Tauri 里直接 toast 给用户）。 */
  path: string;
  bytes: number;
  files: number;
  createdAt: string;
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function readError(response: Response): Promise<never> {
  let detail = `请求失败（HTTP ${response.status}）`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    detail = body.message ?? body.error ?? detail;
  } catch { /* 非 JSON */ }
  throw new Error(detail);
}

/**
 * 导出全部数据。Tauri 里走 POST，落到下载目录并拿到路径；
 * 浏览器开发环境走 GET，让浏览器自己下载（Content-Disposition: attachment）。
 */
export async function exportAll(): Promise<ExportResult | { download: true }> {
  if (!inTauri()) {
    const link = document.createElement("a");
    link.href = `${API_BASE}/api/export`;
    link.download = "";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    return { download: true };
  }
  const response = await fetch(`${API_BASE}/api/export`, { method: "POST" });
  if (!response.ok) return readError(response);
  return (await response.json()) as ExportResult;
}

export interface DeleteAllResult {
  ok: true;
  deleted: Record<string, number>;
}

/** 删除全部数据（需要确认字符串）。成功后调用方清 localStorage 并 reload。 */
export async function deleteAll(): Promise<DeleteAllResult> {
  const response = await fetch(`${API_BASE}/api/data`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "DELETE_ALL" }),
  });
  if (!response.ok) return readError(response);
  return (await response.json()) as DeleteAllResult;
}

/** 清掉本机的前端偏好（`wp.*`），配合删除全部后回到首次引导。 */
export function clearLocalPreferences(storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): string[] {
  if (!storage) return [];
  const removed: string[] = [];
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key && key.startsWith("wp.")) {
      storage.removeItem(key);
      removed.push(key);
    }
  }
  return removed;
}
