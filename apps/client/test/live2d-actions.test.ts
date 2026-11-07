import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cubism4MotionManager } from "pixi-live2d-display/cubism4";
import { chooseTapAction, loadTapActions } from "../src/avatar/live2d/actions.ts";

test("tap actions include only loaded short motions from the current model and disable looping", async () => {
  const loopSettings = new Map<string, boolean>();
  const durations = new Map([
    ["Idle:0", 4],
    ["Short:0", 0.47],
    ["Short:1", 1.2],
    ["Long:0", 4.8],
  ]);
  const manager = {
    groups: { idle: "Idle" },
    definitions: { Idle: [{}], Short: [{}, {}], Long: [{}] },
    loadMotion: async (group: string, index: number) => {
      const key = `${group}:${index}`;
      const duration = durations.get(key);
      return duration === undefined ? undefined : {
        getDuration: () => duration,
        setIsLoop: (loop: boolean) => loopSettings.set(key, loop),
      };
    },
  } as unknown as Cubism4MotionManager;

  const actions = await loadTapActions(manager);
  assert.deepEqual(actions, [
    { group: "Short", index: 0 },
    { group: "Short", index: 1 },
  ]);
  assert.deepEqual([...loopSettings.entries()], [["Short:0", false], ["Short:1", false]]);
  assert.equal(loopSettings.has("Long:0"), false);
});

test("tap action selection is random within the supported set and handles no actions", () => {
  const actions = [{ group: "A", index: 0 }, { group: "B", index: 2 }] as const;
  assert.equal(chooseTapAction(actions, () => 0)?.group, "A");
  assert.equal(chooseTapAction(actions, () => 0.99)?.group, "B");
  assert.equal(chooseTapAction([], () => 0), null);
});
