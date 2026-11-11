import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { attachEventStream, EventBus } from "../src/hub/events.ts";

function fakeResponse() {
  const chunks: string[] = [];
  const response = {
    writableEnded: false,
    destroyed: false,
    write(text: string) { chunks.push(text); return true; },
    writeHead() { return response; },
    setHeader() {},
    on() { return response; },
  };
  return { response: response as unknown as ServerResponse, chunks };
}

test("after the hub restarts, a client with an older, larger Last-Event-ID still gets new events", () => {
  const bus = new EventBus();
  bus.publish("diary.updated", { n: 1 });
  const { response, chunks } = fakeResponse();
  // 客户端是在上一个进程里连的，手里的 id 是 5000；新进程才发到 1。
  const stop = attachEventStream(bus, response, 5000, 60_000);
  try {
    assert.ok(chunks.some((chunk) => chunk.includes("event: resync")), "要先让客户端整体重拉");
    bus.publish("message.created", { text: "主动消息" });
    assert.ok(chunks.some((chunk) => chunk.includes("event: message.created")), "重启后的新事件不能被旧 id 过滤掉");
  } finally {
    stop();
  }
});
