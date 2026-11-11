import assert from "node:assert/strict";
import type { Server } from "node:http";
import { test } from "node:test";
import { closeServerAndDrain } from "../src/server/shutdown.ts";

test("shutdown closes the server first, then waits for diary/memory drain before resolving", async () => {
  const order: string[] = [];
  let finishClose!: () => void;
  let finishDrain!: () => void;
  const server = {
    close(callback: () => void) {
      order.push("server.close");
      finishClose = callback;
    },
    closeAllConnections() {
      order.push("closeAllConnections");
    },
  } as unknown as Server;
  const drain = () => {
    order.push("drain.start");
    return new Promise<void>((resolve) => { finishDrain = resolve; });
  };

  let settled = false;
  const running = closeServerAndDrain(server, drain).then(() => { settled = true; });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["server.close", "closeAllConnections"], "close 回调前不能开始收尾");

  finishClose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["server.close", "closeAllConnections", "drain.start"]);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "日记/记忆收尾完成前不能退出");

  finishDrain();
  await running;
  assert.equal(settled, true);
});

test("an already closed server still drains", async () => {
  let drained = false;
  const server = {
    close(callback: () => void) { callback(); },
    closeAllConnections() {},
  } as unknown as Server;
  await closeServerAndDrain(server, async () => { drained = true; });
  assert.equal(drained, true);
});
