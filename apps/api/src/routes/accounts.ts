import type { IncomingMessage, ServerResponse } from "node:http";
import { AccountError } from "../accounts.ts";
import { sendJson } from "../http.ts";
import type { ServerDeps } from "../server-types.ts";

export async function handleAccountsRoute(deps: Pick<ServerDeps, "accounts">, request: IncomingMessage, response: ServerResponse, url: URL) {
  const accounts = deps.accounts;
  if (!accounts) return sendJson(response, 503, { error: "账号功能未启用。" });
  try {
    if (request.method === "GET" && url.pathname === "/api/accounts") {
      return sendJson(response, 200, { accounts: await accounts.list() });
    }
    const login = /^\/api\/accounts\/([a-z]+)\/login$/.exec(url.pathname);
    if (login && request.method === "POST") return sendJson(response, 200, await accounts.startLogin(login[1]));
    if (login && request.method === "GET") {
      const key = url.searchParams.get("key") ?? "";
      if (!/^[\w-]{16,64}$/.test(key)) throw new AccountError("二维码标识无效。");
      return sendJson(response, 200, { status: await accounts.checkLogin(login[1], key) });
    }
    const account = /^\/api\/accounts\/([a-z]+)$/.exec(url.pathname);
    if (account && request.method === "DELETE") {
      await accounts.logout(account[1]);
      return sendJson(response, 200, { ok: true });
    }
    return sendJson(response, 404, { error: "未找到。" });
  } catch (error) {
    const status = error instanceof AccountError ? 400 : 502;
    const message = error instanceof Error ? error.message : "账号请求失败。";
    return sendJson(response, status, { error: message.replace(/SESSDATA=[^\s&;]+/gi, "SESSDATA=[隐藏]") });
  }
}
