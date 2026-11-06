import { API_BASE } from "./api";

export interface Profile {
  nickname: string | null;
}

async function readError(response: Response): Promise<never> {
  let detail = `请求失败（HTTP ${response.status}）`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    detail = body.message ?? body.error ?? detail;
  } catch { /* 非 JSON */ }
  throw new Error(detail);
}

/** 她怎么称呼你；没设置过就是 null。 */
export async function getProfile(signal?: AbortSignal): Promise<Profile> {
  try {
    const response = await fetch(`${API_BASE}/api/profile`, { signal });
    if (!response.ok) return { nickname: null };
    return (await response.json()) as Profile;
  } catch {
    return { nickname: null };
  }
}

/** `null` 表示清除昵称；不合法时抛错，message 是中文提示。 */
export async function putNickname(nickname: string | null): Promise<Profile> {
  const response = await fetch(`${API_BASE}/api/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  if (!response.ok) return readError(response);
  return (await response.json()) as Profile;
}

/**
 * 旧版把昵称存在 `localStorage["wp.nickname"]`。读到旧值就迁到后端，然后删掉本地副本。
 * 返回迁移后的昵称；没有旧值或迁移失败时返回 null（不打断引导）。
 */
export async function migrateLegacyNickname(storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): Promise<string | null> {
  const legacy = storage?.getItem("wp.nickname")?.trim();
  if (!legacy) return null;
  try {
    const profile = await putNickname(legacy);
    storage?.removeItem("wp.nickname");
    return profile.nickname;
  } catch {
    return null;
  }
}
