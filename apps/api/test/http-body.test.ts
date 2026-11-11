import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { readJsonBody, RequestBodyError, sendJson } from "../src/server/http.ts";

let server: Server;
let base = "";

before(async () => {
  server = createServer(async (request, response) => {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, { body });
    } catch (error) {
      if (error instanceof RequestBodyError) {
        sendJson(response, error.status, { error: error.message, code: error.code });
      } else {
        sendJson(response, 500, { error: "unexpected" });
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("valid JSON object is accepted", async () => {
  const response = await fetch(`${base}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { body: { ok: true } });
});

test("invalid JSON returns 400 instead of 500", async () => {
  const response = await fetch(`${base}/`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, "invalid_json");
});

test("a non-object JSON body returns 400 instead of 500", async () => {
  const response = await fetch(`${base}/`, { method: "POST", headers: { "content-type": "application/json" }, body: "[]" });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, "invalid_body");
});

test("a body over 64 KB returns 413 and the client still gets the response", async () => {
  const response = await fetch(`${base}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "x".repeat(70 * 1024) }),
  });
  assert.equal(response.status, 413);
  assert.equal(((await response.json()) as { code: string }).code, "body_too_large");

  // 连接没有被中途销毁：紧接着还能发一个正常请求。
  const followUp = await fetch(`${base}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ again: true }) });
  assert.equal(followUp.status, 200);
});
