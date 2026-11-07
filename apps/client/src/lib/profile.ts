import { API_BASE } from "./api";
import { describeNetError } from "./net";

export interface Profile {
  nickname: string | null;
}

/**
 * 后端字段叫 `userName`（规范 §10.5 B5，`GET /api/profile` → `{ userName }`），
 * 界面上叫「昵称」。翻译只在这个文件里做一次。
 *
 * 0.2.3 之前这里读写的是 `nickname`，跟后端对不上：读回来永远是空，点「记下」
 * 服务端拿到的 `userName` 是 undefined → 400「这个名字用不了」。现在按线上字段走。
 */
interface WireProfile {
  userName?: string | null;
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
    const body = (await response.json()) as WireProfile;
    return { nickname: body.userName ?? null };
  } catch {
    return { nickname: null };
  }
}

/** `null` 表示清除昵称；不合法时抛错，message 是中文提示。 */
export async function putNickname(nickname: string | null): Promise<Profile> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: nickname }),
    });
  } catch (error) {
    throw new Error(describeNetError(error, "昵称没存上"));
  }
  if (!response.ok) return readError(response);
  const body = (await response.json()) as WireProfile;
  return { nickname: body.userName ?? null };
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
