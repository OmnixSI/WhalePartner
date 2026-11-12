import assert from "node:assert/strict";
import test from "node:test";
import { createRelationshipLoader } from "../src/lib/relationship-loader.ts";

/** 假 fetch：不理会 abort 信号（模拟响应已经到手、只差 .then 的那一小段），由测试决定什么时候、怎么结束。 */
function harness() {
  const calls: { id: string; resolve: (v: number) => void; reject: (e: unknown) => void; signal: AbortSignal }[] = [];
  const ready: [string, number][] = [];
  const errors: string[] = [];
  const loader = createRelationshipLoader<number>(
    (id, signal) => new Promise((resolve, reject) => { calls.push({ id, resolve, reject, signal }); }),
    { onReady: (id, v) => ready.push([id, v]), onError: (id) => errors.push(id) },
  );
  return { calls, ready, errors, loader };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("同一角色：旧请求晚到，不覆盖先完成的新请求", async () => {
  const { calls, ready, loader } = harness();
  loader.load(["whale"]); // 旧
  loader.load(["whale"]); // 新
  assert.equal(calls[0].signal.aborted, true, "发新请求时旧的被中止");
  calls[1].resolve(4);
  await tick();
  calls[0].resolve(3); // 旧的晚到
  await tick();
  assert.deepEqual(ready, [["whale", 4]]);
});

test("同一角色：旧请求先到也不算数（它已经被新请求取代）", async () => {
  const { calls, ready, loader } = harness();
  loader.load(["whale"]);
  loader.load(["whale"]);
  calls[0].resolve(3);
  await tick();
  assert.deepEqual(ready, []);
  calls[1].resolve(4);
  await tick();
  assert.deepEqual(ready, [["whale", 4]]);
});

test("同一角色：旧请求失败晚到，不把新请求的结果标成 error", async () => {
  const { calls, ready, errors, loader } = harness();
  loader.load(["whale"]);
  loader.load(["whale"]);
  calls[1].resolve(4);
  await tick();
  calls[0].reject(new Error("HTTP 500"));
  await tick();
  assert.deepEqual(ready, [["whale", 4]]);
  assert.deepEqual(errors, []);
});

test("不同角色互不作废；pending 反映是否还在路上", async () => {
  const { calls, ready, loader } = harness();
  loader.load(["whale", "claude"]);
  assert.equal(loader.pending("whale"), true);
  calls[1].resolve(1);
  await tick();
  assert.equal(loader.pending("claude"), false);
  assert.equal(loader.pending("whale"), true);
  calls[0].resolve(3);
  await tick();
  assert.deepEqual(ready.sort(), [["claude", 1], ["whale", 3]]);
});

test("abortAll 之后到的响应（卸载）不再写回", async () => {
  const { calls, ready, errors, loader } = harness();
  loader.load(["whale"]);
  loader.abortAll();
  calls[0].resolve(3);
  await tick();
  assert.deepEqual(ready, []);
  assert.deepEqual(errors, []);
});

test("旧 Promise 已 settle、.then 未执行时发新请求：旧的成功结果不覆盖新结果", async () => {
  const { calls, ready, loader } = harness();
  loader.load(["whale"]);
  calls[0].resolve(3); // 已 settle，成功回调还排在微任务队列里
  loader.load(["whale"]); // 旧 .then 执行前发出新请求
  calls[1].resolve(4);
  await tick();
  assert.deepEqual(ready, [["whale", 4]]);
});

test("旧 Promise 已 settle、.then 未执行时发新请求：旧的失败结果不把新结果标成 error", async () => {
  const { calls, ready, errors, loader } = harness();
  loader.load(["whale"]);
  calls[0].reject(new Error("HTTP 500")); // 已 settle，失败回调还排在微任务队列里
  loader.load(["whale"]);
  calls[1].resolve(4);
  await tick();
  assert.deepEqual(ready, [["whale", 4]]);
  assert.deepEqual(errors, []);
});
