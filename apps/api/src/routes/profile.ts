import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../http.ts";
import type { ServerDeps } from "../server-types.ts";

/**
 * 昵称（规范 §10.5 B5）——从 P-B 分支移植到 main 的新路由结构。
 * GET /api/profile → { userName }；PUT /api/profile 校验 1–12 字、禁控制字符与 < > `。
 * 注入人格提示（persona.withUserName）需要聊天链路改造，留到后续；这里先把读写做稳。
 */
const MAX_NAME = 12;

/** 供别的路由读取当前昵称；表不存在就当没设。 */
export function readUserName(dbPath: string): string | null {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT value FROM user_profile WHERE key = 'userName'").get() as { value?: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function openProfile(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS user_profile (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
}

function validate(raw: unknown): { ok: true; name: string } | { ok: false; code: string } {
  const name = String(raw ?? "").trim();
  if (name.length === 0) return { ok: false, code: "empty" };
  if (name.length > MAX_NAME) return { ok: false, code: "too_long" };
  if (/[\u0000-\u001f\u007f<>`]/.test(name)) return { ok: false, code: "invalid_chars" };
  return { ok: true, name };
}

export async function handleProfileRoute(
  deps: ServerDeps,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/profile") return false;
  let db: DatabaseSync | undefined;
  try {
    db = openProfile(deps.config.dbPath);
    if (request.method === "GET") {
      const row = db.prepare("SELECT value FROM user_profile WHERE key = 'userName'").get() as { value?: string } | undefined;
      sendJson(response, 200, { userName: row?.value ?? null });
      return true;
    }
    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const raw = (body as { userName?: unknown } | null)?.userName;
      // 明确给 null 就是「清掉」：界面上把昵称删空后点「记下」走这条。
      if (raw === null) {
        db.prepare("DELETE FROM user_profile WHERE key = 'userName'").run();
        sendJson(response, 200, { userName: null });
        return true;
      }
      const checked = validate(raw);
      if (!checked.ok) {
        sendJson(response, 400, { error: checked.code, message: "这个名字用不了，换一个试试。" });
        return true;
      }
      db.prepare("INSERT INTO user_profile(key, value) VALUES('userName', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(checked.name);
      sendJson(response, 200, { userName: checked.name });
      return true;
    }
    sendJson(response, 405, { error: "method_not_allowed", message: "只支持 GET / PUT。" });
    return true;
  } catch {
    sendJson(response, 503, { error: "profile_unavailable", message: "现在拿不到，先记不了。" });
    return true;
  } finally {
    db?.close();
  }
}
