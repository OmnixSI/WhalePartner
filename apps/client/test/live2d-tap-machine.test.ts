import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseTapAction, type TapAction } from "../src/avatar/live2d/actions.ts";
import { classifyTap, regionFromBounds, regionFromHitAreas } from "../src/avatar/live2d/hit.ts";
import {
  FALLBACK_MS,
  initialTapState,
  reduceTap,
  watchdogMs,
  WATCHDOG_MAX_MS,
  type TapContext,
  type TapEffect,
  type TapEvent,
  type TapState,
} from "../src/avatar/live2d/tap-machine.ts";
import { cubismVersionOf } from "../src/avatar/live2d/runtime.ts";

const short: TapAction = { group: "Short", index: 0, duration: undefined };
const ctx = (actions: TapAction[] = [short]): TapContext => ({ actions, expressions: ["a", "b"], random: () => 0, choose: chooseTapAction });

function run(state: TapState, event: TapEvent, c: TapContext) {
  return reduceTap(state, event, c);
}

test("20 rapid taps all produce a play effect and never get rejected", () => {
  let state = initialTapState;
  let plays = 0;
  for (let i = 0; i < 20; i++) {
    const r = run(state, { type: "tap", now: 1000 + i * 30, region: i % 2 ? "head" : "body" }, ctx());
    state = r.state;
    plays += r.effects.filter((e) => e.type === "play").length;
    assert.equal(state.phase, "acting");
    assert.equal(state.seq, i + 1);
  }
  assert.equal(plays, 20);
});

test("taps still react when the model has no usable actions (fallback expression + bounce)", () => {
  const r = run(initialTapState, { type: "tap", now: 0, region: "head" }, ctx([]));
  const play = r.effects[0] as Extract<TapEffect, { type: "play" }>;
  assert.equal(play.action, null);
  assert.equal(play.fallback.expression, "a");
  assert.ok(play.fallback.bounce > 0);
  assert.equal(r.state.deadline, FALLBACK_MS);
});

test("watchdog resets a lock when motionFinish never arrives", () => {
  let r = run(initialTapState, { type: "tap", now: 0, region: "body" }, ctx([{ group: "S", index: 0 }]));
  assert.equal(r.state.deadline, WATCHDOG_MAX_MS);
  assert.deepEqual(run(r.state, { type: "tick", now: WATCHDOG_MAX_MS - 1 }, ctx()).effects, []);
  r = run(r.state, { type: "tick", now: WATCHDOG_MAX_MS }, ctx());
  assert.equal(r.state.phase, "idle");
  assert.deepEqual(r.effects, [{ type: "reset", seq: 1, reason: "watchdog" }]);
  // 复位之后下一次点击照常工作
  assert.equal(run(r.state, { type: "tap", now: 5000, region: "body" }, ctx()).effects[0].type, "play");
});

test("watchdog deadline is duration + 500ms, capped at 4s", () => {
  assert.equal(watchdogMs({ group: "x", index: 0, duration: 1.2 }), 1700);
  assert.equal(watchdogMs({ group: "x", index: 0, duration: 9 }), WATCHDOG_MAX_MS);
  assert.equal(watchdogMs(null), FALLBACK_MS);
});

test("stale motionFinish from a preempted tap is ignored; current one resets", () => {
  let s = run(initialTapState, { type: "tap", now: 0, region: "body" }, ctx()).state;
  s = run(s, { type: "tap", now: 10, region: "body" }, ctx()).state; // seq 2
  assert.deepEqual(run(s, { type: "motionFinish", seq: 1 }, ctx()).effects, []);
  const done = run(s, { type: "motionFinish", seq: 2 }, ctx());
  assert.equal(done.state.phase, "idle");
  assert.equal(done.effects[0].type, "reset");
});

test("dispose resets an active action and is a no-op when idle", () => {
  const s = run(initialTapState, { type: "tap", now: 0, region: "body" }, ctx()).state;
  assert.equal(run(s, { type: "dispose" }, ctx()).effects[0].type, "reset");
  assert.deepEqual(run(initialTapState, { type: "dispose" }, ctx()).effects, []);
});

test("region: model HitAreas win; otherwise top third of the bounding box is the head", () => {
  assert.equal(regionFromHitAreas([]), null);
  assert.equal(regionFromHitAreas(["Head"]), "head");
  assert.equal(regionFromHitAreas(["Body"]), "body");
  const box = { x: 0, y: 100, width: 100, height: 300 };
  assert.equal(regionFromBounds(box, 150), "head");
  assert.equal(regionFromBounds(box, 250), "body");
  assert.equal(classifyTap([], box, 150), "head");
  assert.equal(classifyTap(["Body"], box, 150), "body");
});

test("region-aware action choice prefers matching groups and falls back to all", () => {
  const actions: TapAction[] = [{ group: "TapHead", index: 0 }, { group: "TapBody", index: 0 }, { group: "Wave", index: 0 }];
  assert.equal(chooseTapAction(actions, () => 0, "head")?.group, "TapHead");
  assert.equal(chooseTapAction(actions, () => 0, "body")?.group, "TapBody");
  assert.equal(chooseTapAction([{ group: "Wave", index: 0 }], () => 0, "head")?.group, "Wave");
});

test("cubism version is picked from the model file name", () => {
  assert.equal(cubismVersionOf("/a/b.model3.json?x=1"), 4);
  assert.equal(cubismVersionOf("/a/b.model.json"), 2);
});
