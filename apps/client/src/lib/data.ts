import { API_BASE } from "./api";
import { describeNetError } from "./net";

export interface ExportResult {
  ok: true;
  /** 导出文件在本机的完整路径（Tauri 里直接 toast 给用户）。 */
  path: string;
  bytes: number;
  files: number;
  createdAt: string;
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
/**
 * 导出全部数据：先 POST 拿 id，再 GET 下载 zip。
 * 两个环境都走「抓成 blob 再点链」，这样文件名固定是 .zip，
 * 也不会出现浏览器直接 GET 到 404 JSON 的情况。
 */
export async function exportAll(): Promise<{ download: true; filename: string }> {
  let created: Response;
  let file: Response;
  try {
    created = await fetch(`${API_BASE}/api/export`, { method: "POST" });
    if (!created.ok) await readError(created);
    const { id } = (await created.json()) as { id: string };
    file = await fetch(`${API_BASE}/api/export?id=${encodeURIComponent(id)}`);
  } catch (error) {
    throw new Error(describeNetError(error, "导出没成"));
  }
  if (!file.ok) await readError(file);

  const blob = await file.blob();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `whalepartner-${stamp}.zip`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { download: true, filename };
}

export interface DeleteAllResult {
  ok: true;
  deleted: Record<string, number>;
}

/** 删除全部数据（需要确认字符串）。成功后调用方清 localStorage 并 reload。 */
export async function deleteAll(): Promise<DeleteAllResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/data`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE_ALL" }),
    });
  } catch (error) {
    throw new Error(describeNetError(error, "删除没成"));
  }
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
