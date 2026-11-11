/**
 * 昵称接口契约。
 *
 * 0.2.3 的坑：客户端读写的是 `nickname`，服务端字段是 `userName`，两边各说各话——
 * 读回来永远是空，点「记下」服务端拿到 undefined，回 400「这个名字用不了」。
 * 这个文件把线上字段钉死：`GET /api/profile → { userName }`，`PUT { userName }`。
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";
import { SurfService } from "../src/surf/service.ts";
import { baseConfig, fakeMemory, fakeProvider, fakeVideo, fakeWeb, makeStore, messageSink, tempDb } from "./surf-fakes.ts";

const { store: surfStore, path } = makeStore();
const { provider } = fakeProvider();
const server: Server = createApiServer({
  config: baseConfig({ dbPath: path }),
  provider: new FallbackChatProvider([provider]),
  store: new ChatStore(path),
  surf: new SurfService({
    store: surfStore,
    provider,
    memory: fakeMemory(),
    messages: messageSink(),
    video: fakeVideo(),
    web: fakeWeb(),
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    dir: tempDb("profile-dir").dir,
  }),
});
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const put = (body: unknown) =>
  fetch(`${base}/api/profile`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("没设过的时候是 null（字段叫 userName）", async () => {
  const response = await fetch(`${base}/api/profile`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userName: null });
});

test("存一个名字，GET 能读回来", async () => {
  const saved = await put({ userName: "阿明" });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { userName: "阿明" });

  const read = await fetch(`${base}/api/profile`);
  assert.deepEqual(await read.json(), { userName: "阿明" });
});

test("传 null 是清掉，不是报错", async () => {
  await put({ userName: "临时名字" });
  const cleared = await put({ userName: null });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { userName: null });
  assert.deepEqual(await (await fetch(`${base}/api/profile`)).json(), { userName: null });
});

test("超长和带尖括号的会被拒，且给出中文原因", async () => {
  const tooLong = await put({ userName: "名".repeat(13) });
  assert.equal(tooLong.status, 400);
  const body = (await tooLong.json()) as { message?: string };
  assert.match(body.message ?? "", /名字/);

  const bad = await put({ userName: "<script>" });
  assert.equal(bad.status, 400);
});

test("缺字段就是 400（客户端别再传 nickname）", async () => {
  const response = await put({ nickname: "阿明" });
  assert.equal(response.status, 400);
});
