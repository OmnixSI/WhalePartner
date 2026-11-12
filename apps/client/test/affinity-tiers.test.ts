import assert from "node:assert/strict";
import test from "node:test";
import {
  CALM_STEP_MS,
  CARD_TIERS,
  UPGRADE_CHAIN_MAX_MS,
  UPGRADE_STEP_MS,
  clampLevel,
  tierFeatures,
  tierOf,
  upgradeSteps,
} from "../src/card-preview/tier/tiers.ts";

test("five tiers follow the backend stages, Lv5 相依 starts at 500", () => {
  assert.deepEqual(CARD_TIERS.map((t) => [t.level, t.label, t.threshold]), [
    [1, "相识", 0], [2, "相熟", 25], [3, "默契", 100], [4, "亲近", 250], [5, "相依", 500],
  ]);
  assert.equal(tierOf(5).finish, "鎏金箔");
});

test("levels are clamped into 1–5", () => {
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel(9), 5);
  assert.equal(clampLevel(3.7), 3);
  assert.equal(clampLevel(Number.NaN), 1);
  assert.equal(tierOf(-2).level, 1);
});

test("tier features grow with the level", () => {
  assert.deepEqual(tierFeatures(1), { tilt: false, live2dIdle: false, signature: false, foil: false });
  assert.deepEqual(tierFeatures(3), { tilt: true, live2dIdle: true, signature: false, foil: false });
  assert.deepEqual(tierFeatures(5), { tilt: true, live2dIdle: true, signature: true, foil: true });
});

test("a single step uses its own duration; no step when not going up", () => {
  assert.deepEqual(upgradeSteps(4, 5), [{ from: 4, to: 5, ms: UPGRADE_STEP_MS[5] }]);
  assert.deepEqual(upgradeSteps(3, 3), []);
  assert.deepEqual(upgradeSteps(5, 2), []);
});

test("a chain plays every tier in order and fits in the chain budget", () => {
  const steps = upgradeSteps(1, 5);
  assert.deepEqual(steps.map((s) => `${s.from}→${s.to}`), ["1→2", "2→3", "3→4", "4→5"]);
  const total = steps.reduce((n, s) => n + s.ms, 0);
  assert.ok(total <= UPGRADE_CHAIN_MAX_MS, `total ${total}`);
  assert.ok(steps[3].ms > steps[0].ms, "higher tiers keep a longer step after scaling");
});

test("calm mode uses the short fade for every step", () => {
  const steps = upgradeSteps(1, 5, true);
  assert.equal(steps.length, 4);
  assert.ok(steps.every((s) => s.ms === CALM_STEP_MS));
});

test("card tiers match the backend relationship stages end to end", async () => {
  const { RELATIONSHIP_STAGES } = await import("../../api/src/relationship/policy.ts");
  assert.deepEqual(
    CARD_TIERS.map((t) => [t.level, t.label, t.threshold]),
    RELATIONSHIP_STAGES.map((s) => [s.level, s.label, s.threshold]),
  );
  assert.deepEqual(RELATIONSHIP_STAGES.at(-1), { level: 5, threshold: 500, label: "相依", effect: "镀闪卡面" });
});
