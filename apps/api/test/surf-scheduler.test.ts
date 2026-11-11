import assert from "node:assert/strict";
import { test } from "node:test";
import { SurfScheduler } from "../src/surf/scheduler.ts";
import { SurfService } from "../src/surf/service.ts";
import { fakeVideo, fakeWeb, makeStore, seedChat } from "./surf-fakes.ts";
import { fakeProvider } from "./surf-fakes.ts";

function build() {
  const { store, path } = makeStore();
  const { provider } = fakeProvider();
  const service = new SurfService({
    store,
    provider,
    video: fakeVideo(),
    web: fakeWeb(),
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    now: () => new Date(2026, 10, 7, 9, 31, 0),
  });
  let enabled = true;
  const scheduler = new SurfScheduler({ service, enabled: () => enabled, characters: ["whale"] });
  return {
    store,
    path,
    service,
    scheduler,
    setEnabled: (next: boolean) => {
      enabled = next;
    },
  };
}

const at = (hour: number, minute = 31) => new Date(2026, 10, 7, hour, minute, 0);

test("到点触发：09:31 补上 09:30 那一槽", async () => {
  const { store, scheduler, path } = build();
  seedChat(path);
  const result = await scheduler.tick(at(9));
  assert.deepEqual(result.started, ["whale"]);
  const session = store.sessionBySlot("whale", "2026-11-07 09:30");
  assert.ok(session, "会话行要落在槽位上");
  assert.equal(session?.status, "done");
  store.close();
});

test("睡一觉醒来：60 分钟宽限内补跑一次，超出就不补", async () => {
  const { store, scheduler, path } = build();
  seedChat(path);
  const late = await scheduler.tick(at(10, 20));
  assert.deepEqual(late.started, ["whale"], "09:30 槽位晚了 50 分钟，仍在宽限内");
  store.close();

  const second = build();
  seedChat(second.path);
  const tooLate = await second.scheduler.tick(at(10, 40));
  assert.deepEqual(tooLate.started, [], "晚了 70 分钟，不再补");
  assert.equal(second.store.sessionBySlot("whale", "2026-11-07 09:30"), undefined);
  second.store.close();
});

test("同一槽位只跑一次", async () => {
  const { store, scheduler, path } = build();
  seedChat(path);
  assert.deepEqual((await scheduler.tick(at(9))).started, ["whale"]);
  const again = await scheduler.tick(at(9));
  assert.deepEqual(again.started, []);
  assert.equal(again.skipped.length, 0, "槽位已经逛过，连 skip 都不记");
  const rows = store.feed({ character: "whale", page: 1, pageSize: 50 });
  assert.equal(rows.total, 3, "只跑了一趟，不会翻倍");
  store.close();
});

test("角色开关关掉后不再触发，也不留下会话", async () => {
  const { store, scheduler, path } = build();
  seedChat(path);
  store.putSettings("whale", { enabled: false }, at(9).toISOString());
  const result = await scheduler.tick(at(9));
  assert.deepEqual(result.started, []);
  assert.equal(store.sessionBySlot("whale", "2026-11-07 09:30"), undefined);
  store.close();
});

test("全局总闸关掉后 tick 直接返回", async () => {
  const { store, scheduler, path, service, setEnabled } = build();
  seedChat(path);
  setEnabled(false);
  const result = await scheduler.tick(at(9));
  assert.deepEqual(result.started, []);
  assert.equal(store.sessionBySlot("whale", "2026-11-07 09:30"), undefined);
  assert.equal(service.enabled, true, "服务本身的开关是另一码事（这里没关）");
  store.close();
});

test("没有近 14 天聊天记录的角色不去逛", async () => {
  const { store, scheduler } = build();
  const result = await scheduler.tick(at(9));
  assert.deepEqual(result.started, []);
  assert.deepEqual(result.skipped, [{ character: "whale", reason: "inactive" }]);
  assert.equal(store.sessionBySlot("whale", "2026-11-07 09:30"), undefined);
  store.close();
});

test("频率决定槽位：偶尔只在 11:40 / 19:20", async () => {
  const { store, scheduler, path } = build();
  seedChat(path);
  store.putSettings("whale", { frequency: "rare" }, at(9).toISOString());
  assert.deepEqual((await scheduler.tick(at(9))).started, [], "09:30 不是偶尔的槽位");
  assert.deepEqual((await scheduler.tick(at(11, 41))).started, ["whale"]);
  store.close();
});

test("cron 的下一次 tick 不会叠在还没逛完的那一趟上", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(2026, 10, 7, 9, 31, 0) });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  let runs = 0;
  let finish: () => void = () => {};
  const unfinished = new Promise<void>((resolve) => { finish = resolve; });
  // 只用到调度器读的那几样：09:30 的槽位一直「到点、没逛过」，run 迟迟不结束。
  const service = {
    enabled: true,
    store: {
      getSettings: () => ({ enabled: true, frequency: "normal" }),
      hasSession: () => false,
      retriesForSlot: () => 0,
      sessionBySlot: () => undefined,
      hasRecentChat: () => true,
    },
    async run() {
      runs += 1;
      await unfinished;
      return { sessionId: null, state: "done", reason: null, items: 0 };
    },
  } as unknown as SurfService;
  const scheduler = new SurfScheduler({ service, characters: ["whale"] });
  const stop = scheduler.start("* * * * *");
  try {
    context.mock.timers.tick(60_000);
    await settle();
    assert.equal(runs, 1, "09:32 开始逛");
    context.mock.timers.tick(60_000);
    await settle();
    assert.equal(runs, 1, "09:33 上一趟还没逛完，这次 tick 跳过");
    finish();
    await settle();
    context.mock.timers.tick(60_000);
    await settle();
    assert.equal(runs, 2, "上一趟结束后照常触发");
  } finally {
    finish();
    await settle();
    stop();
  }
});
