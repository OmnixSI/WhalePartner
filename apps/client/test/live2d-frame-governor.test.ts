import assert from "node:assert/strict";
import { test } from "node:test";
import { createFrameGovernor, type GovernedTicker } from "../src/avatar/live2d/frame-governor.ts";

/** 假时钟 + 假 ticker：advance(ms) 按时间顺序跑定时器。 */
function rig(opts: { hidden?: boolean; busy?: boolean } = {}) {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const state = { hidden: opts.hidden ?? false, busy: opts.busy ?? false };
  const ticker = { started: true, updates: 0, starts: 0, stops: 0 } as GovernedTicker & { updates: number; starts: number; stops: number };
  Object.assign(ticker, {
    start() { this.started = true; this.starts += 1; },
    stop() { this.started = false; this.stops += 1; },
    update() { this.updates += 1; },
  });
  const gov = createFrameGovernor({
    ticker,
    isHidden: () => state.hidden,
    isBusy: () => state.busy,
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      t = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    t = end;
  };
  return { gov, ticker, state, advance, pending: () => timers.size };
}

test("stays active until the quiet period passes, then drops to a slow manual tick", () => {
  const { gov, ticker, advance } = rig();
  advance(2000);
  assert.equal(gov.mode(), "active");
  advance(600);
  assert.equal(gov.mode(), "idle");
  assert.equal(ticker.started, false);
  const before = ticker.updates;
  advance(1000);
  assert.equal(ticker.updates - before, 10); // 100ms 一帧 = 10fps
});

test("wake() returns to the full-rate ticker and restarts the quiet timer", () => {
  const { gov, ticker, advance } = rig();
  advance(5000);
  assert.equal(gov.mode(), "idle");
  gov.wake();
  assert.equal(gov.mode(), "active");
  assert.equal(ticker.started, true);
  advance(2000);
  assert.equal(gov.mode(), "active");
  advance(600);
  assert.equal(gov.mode(), "idle");
});

test("busy state (speaking, tap motion) never drops to idle; releases after the quiet period", () => {
  const { gov, state, advance } = rig({ busy: true });
  advance(20_000);
  assert.equal(gov.mode(), "active");
  state.busy = false;
  advance(500); // 复查间隔内发现不忙了，之后还要静置满 idleAfterMs
  advance(3000);
  assert.equal(gov.mode(), "idle");
});

test("busy starting while idle brings the full rate back", () => {
  const { gov, ticker, state, advance } = rig();
  advance(5000);
  assert.equal(gov.mode(), "idle");
  state.busy = true;
  advance(150);
  assert.equal(gov.mode(), "active");
  assert.equal(ticker.started, true);
});

test("hidden stops everything: no ticker, no timers; visible again resumes", () => {
  const { gov, ticker, state, advance, pending } = rig();
  advance(5000);
  state.hidden = true;
  gov.sync();
  assert.equal(gov.mode(), "paused");
  assert.equal(ticker.started, false);
  assert.equal(pending(), 0);
  const updates = ticker.updates;
  advance(10_000);
  assert.equal(ticker.updates, updates);
  gov.wake(); // 隐藏时来的输入不能把它叫醒
  assert.equal(gov.mode(), "paused");
  state.hidden = false;
  gov.sync();
  assert.equal(gov.mode(), "active");
  assert.equal(ticker.started, true);
});

test("hiding while idle stops the manual tick on the next step", () => {
  const { gov, ticker, state, advance, pending } = rig();
  advance(5000);
  state.hidden = true;
  advance(150);
  assert.equal(gov.mode(), "paused");
  assert.equal(pending(), 0);
  assert.equal(ticker.started, false);
});

test("dispose clears timers", () => {
  const { gov, advance, pending } = rig();
  gov.dispose();
  assert.equal(pending(), 0);
  advance(10_000);
  assert.equal(gov.mode(), "active");
});
