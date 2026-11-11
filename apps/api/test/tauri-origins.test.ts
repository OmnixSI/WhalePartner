import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { originAllowed } from "../src/hub/auth.ts";

const request = (origin: string | undefined, host = "127.0.0.1:51234") =>
  ({ headers: { origin, host } }) as unknown as IncomingMessage;

test("Tauri webview 与开发模式的 Origin 都被放行", () => {
  for (const origin of ["tauri://localhost", "http://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420"]) {
    assert.equal(originAllowed(request(origin), {}), true, origin);
  }
});

test("其他网站的 Origin 仍被拒绝", () => {
  assert.equal(originAllowed(request("https://evil.example"), {}), false);
  assert.equal(originAllowed(request("http://localhost:3000"), {}), false);
});
