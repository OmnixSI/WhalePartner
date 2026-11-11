/**
 * 预检契约测试。
 *
 * 为什么要有这个文件：0.2.3 桌面版里点「开关」会报 `Load failed`，开关自己弹回去。
 * 原因是 `applyCors` 的方法表里没有 PUT，而昵称 / 模型接入 / 逛设置都是 PUT。
 * 开发时页面走 Vite 代理（同源，没有预检），测试全绿；装成 App 之后页面来自
 * `tauri://localhost`，跨源预检被拦，fetch 直接失败。
 *
 * 所以这里的第 2 个测试不看服务端写了什么，而是**扫前端源码**里出现的每一个
 * `method: "X"`，要求方法表全覆盖。以后前端加一个方法、忘了改 server/http.ts，测试就红。
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CORS_ALLOWED_METHODS, CORS_ALLOWED_ORIGINS } from "../src/server/http.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";
import { SurfService } from "../src/surf/service.ts";
import { baseConfig, fakeMemory, fakeProvider, fakeVideo, fakeWeb, makeStore, messageSink, tempDb } from "./surf-fakes.ts";

const { store: surfStore, path } = makeStore();
const { provider } = fakeProvider();
const service = new SurfService({
  store: surfStore,
  provider,
  memory: fakeMemory(),
  messages: messageSink(),
  video: fakeVideo(),
  web: fakeWeb(),
  thumbs: { fetch: async () => null },
  navGap: () => 0,
  dir: tempDb("cors-dir").dir,
});

const server: Server = createApiServer({
  config: baseConfig({ dbPath: path }),
  provider: new FallbackChatProvider([provider]),
  store: new ChatStore(path),
  surf: service,
});
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 走一次真实的预检：和浏览器发的一模一样。 */
async function preflight(origin: string, method: string, headers = "content-type") {
  const response = await fetch(`${base}/api/__probe`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": method,
      "access-control-request-headers": headers,
    },
  });
  return {
    status: response.status,
    allowOrigin: response.headers.get("access-control-allow-origin"),
    allowMethods: (response.headers.get("access-control-allow-methods") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    allowHeaders: response.headers.get("access-control-allow-headers"),
  };
}

test("每个放行来源、每个方法都能过预检", async () => {
  for (const origin of CORS_ALLOWED_ORIGINS) {
    for (const method of CORS_ALLOWED_METHODS) {
      if (method === "OPTIONS") continue; // 预检本身不用再预检
      if (method === "HEAD" || method === "GET") continue; // 简单请求，不会发预检
      const result = await preflight(origin, method);
      assert.equal(result.status, 204, `${origin} ${method} 预检状态`);
      assert.equal(result.allowOrigin, origin, `${origin} ${method} 的 allow-origin`);
      assert.ok(result.allowMethods.includes(method), `${origin} ${method} 没在 allow-methods 里：${result.allowMethods.join(",")}`);
    }
  }
});

test("前端源码里出现的每个 method 都在预检方法表里", async () => {
  const roots = ["../../apps/client/src"];
  const used = new Set<string>();
  for (const root of roots) {
    for (const file of await walk(root)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/method:\s*["']([A-Z]+)["']/g)) used.add(match[1] as string);
    }
  }
  assert.ok(used.size >= 4, `没扫到前端的方法调用，路径是不是变了？（扫到 ${used.size} 个）`);
  const missing = [...used].filter((method) => !(CORS_ALLOWED_METHODS as readonly string[]).includes(method));
  assert.deepEqual(missing, [], `这些方法前端在用、但预检没放行：${missing.join(", ")}`);
});

test("带 Origin 的写入请求能被浏览器读到响应（含 allow-origin 回显）", async () => {
  const origin = "tauri://localhost";
  const response = await fetch(`${base}/api/profile`, {
    method: "PUT",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ userName: "预检客人" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("vary"), "origin");
  const body = (await response.json()) as { userName?: string };
  assert.equal(body.userName, "预检客人");
});

test("未放行的来源拿不到 allow-origin（本机服务不对外开门）", async () => {
  const result = await preflight("https://evil.example.com", "PUT");
  assert.equal(result.allowOrigin, null);
});

test("预检会回显浏览器问的请求头，而不是写死一张表", async () => {
  const result = await preflight("tauri://localhost", "PUT", "content-type, x-whale-client");
  assert.equal(result.allowHeaders, "content-type, x-whale-client");
});

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}
