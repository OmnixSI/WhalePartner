import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { AccountError, type AccountService, type LoginState } from "../src/bilibili/accounts.ts";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";

const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

function fakeAccounts() {
  const calls: string[] = [];
  let connected = false;
  let state: LoginState = "waiting";
  const service: AccountService = {
    async list() { return [{ platform: "bilibili", name: "哔哩哔哩", connected, valid: connected ? true : null, savedAt: connected ? "2026-11-05T00:00:00Z" : null }]; },
    async startLogin(platform) {
      if (platform !== "bilibili") throw new AccountError("这个平台还没有接入。");
      calls.push("start");
      return { key: KEY, url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=" + KEY, expiresInSeconds: 180 };
    },
    async checkLogin(platform, key) {
      if (platform !== "bilibili") throw new AccountError("这个平台还没有接入。");
      calls.push(`check:${key}`);
      if (state === "success") connected = true;
      return state;
    },
    async logout(platform) {
      if (platform !== "bilibili") throw new AccountError("这个平台还没有接入。");
      calls.push("logout");
      connected = false;
    },
  };
  return { service, calls, setState: (next: LoginState) => { state = next; } };
}

const model: ChatProvider = { id: "fake", model: "m", async *stream() { yield { text: "好" }; } };

async function withServer(accounts: AccountService | undefined, run: (base: string) => Promise<void>) {
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([model]), store: new ChatStore(":memory:"), accounts });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try { await run(base); } finally { server.close(); }
}

test("account routes: list, scan-to-login polling, and logout", async () => {
  const { service, calls, setState } = fakeAccounts();
  await withServer(service, async (base) => {
    const before = (await (await fetch(`${base}/api/accounts`)).json()) as { accounts: Array<{ connected: boolean }> };
    assert.equal(before.accounts[0].connected, false);

    const started = (await (await fetch(`${base}/api/accounts/bilibili/login`, { method: "POST" })).json()) as { key: string; url: string; expiresInSeconds: number };
    assert.equal(started.key, KEY);
    assert.ok(started.url.startsWith("https://passport.bilibili.com/"));

    const waiting = (await (await fetch(`${base}/api/accounts/bilibili/login?key=${KEY}`)).json()) as { status: string };
    assert.equal(waiting.status, "waiting");

    setState("success");
    assert.equal(((await (await fetch(`${base}/api/accounts/bilibili/login?key=${KEY}`)).json()) as { status: string }).status, "success");
    assert.equal(((await (await fetch(`${base}/api/accounts`)).json()) as { accounts: Array<{ connected: boolean }> }).accounts[0].connected, true);

    assert.equal((await fetch(`${base}/api/accounts/bilibili`, { method: "DELETE" })).status, 200);
    assert.equal(((await (await fetch(`${base}/api/accounts`)).json()) as { accounts: Array<{ connected: boolean }> }).accounts[0].connected, false);
    assert.deepEqual(calls, ["start", `check:${KEY}`, `check:${KEY}`, "logout"]);
  });
});

test("account routes reject bad keys, unknown platforms, and never expose a session", async () => {
  const { service } = fakeAccounts();
  await withServer(service, async (base) => {
    assert.equal((await fetch(`${base}/api/accounts/bilibili/login?key=x`)).status, 400);
    assert.equal((await fetch(`${base}/api/accounts/bilibili/login?key=../../etc/passwd`)).status, 400);
    assert.equal((await fetch(`${base}/api/accounts/weibo/login`, { method: "POST" })).status, 400);
    assert.equal((await fetch(`${base}/api/accounts/weibo`, { method: "DELETE" })).status, 400);
    const text = await (await fetch(`${base}/api/accounts`)).text();
    assert.equal(/sessdata/i.test(text), false);
  });
  await withServer(undefined, async (base) => {
    assert.equal((await fetch(`${base}/api/accounts`)).status, 503);
  });
});

test("upstream failures become a readable error without leaking cookies", async () => {
  const failing: AccountService = {
    async list() { return []; },
    async startLogin() { throw new Error("B 站二维码生成失败 SESSDATA=secret123"); },
    async checkLogin() { return "error"; },
    async logout() {},
  };
  await withServer(failing, async (base) => {
    const res = await fetch(`${base}/api/accounts/bilibili/login`, { method: "POST" });
    assert.equal(res.status, 502);
    const body = await res.text();
    assert.equal(body.includes("secret123"), false);
    assert.ok(body.includes("二维码生成失败"));
  });
});
