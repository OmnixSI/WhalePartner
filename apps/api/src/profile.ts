import type { DatabaseSync } from "node:sqlite";

export const NICKNAME_KEY = "nickname";
export const INVALID_NICKNAME_MESSAGE = "昵称请用 1 到 12 个字，不要带换行或特殊符号。";

/** 昵称不合法时抛它；路由层转成 400 invalid_nickname。 */
export class NicknameError extends Error {
  readonly code = "invalid_nickname";

  constructor() {
    super(INVALID_NICKNAME_MESSAGE);
    this.name = "NicknameError";
  }
}

/**
 * 去首尾空白后 1–12 个字；不得含控制字符、换行、`<`、`>`、反引号。
 * `null` 表示清除；其余非字符串或超范围一律算不合法。
 */
export function normalizeNickname(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new NicknameError();
  const text = value.trim();
  if (!text) throw new NicknameError();
  if ([...text].length > 12) throw new NicknameError();
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new NicknameError();
  if (/[<>`]/.test(text)) throw new NicknameError();
  return text;
}

export function getNickname(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT value FROM user_profile WHERE key = ?").get(NICKNAME_KEY) as { value?: string } | undefined;
  return row?.value ?? null;
}

export function getProfile(db: DatabaseSync): { nickname: string | null; updatedAt: string | null } {
  const row = db.prepare("SELECT value, updated_at AS updatedAt FROM user_profile WHERE key = ?").get(NICKNAME_KEY) as { value: string; updatedAt: string } | undefined;
  return { nickname: row?.value ?? null, updatedAt: row?.updatedAt ?? null };
}

/** 写入昵称；传 null 清除。返回写入后的昵称。 */
export function setNickname(db: DatabaseSync, value: unknown, now: () => Date = () => new Date()): string | null {
  const nickname = normalizeNickname(value);
  if (nickname === null) {
    db.prepare("DELETE FROM user_profile WHERE key = ?").run(NICKNAME_KEY);
    return null;
  }
  db.prepare("INSERT INTO user_profile (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(NICKNAME_KEY, nickname, now().toISOString());
  return nickname;
}
