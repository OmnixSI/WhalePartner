import assert from "node:assert/strict";
import test from "node:test";
import type { RelationshipProgress, RelationshipSample } from "../src/card-preview/data.ts";
import { levelIntro, nextStageText } from "../src/card-preview/relationship-copy.ts";

const LV4_SAMPLE = { level: 4, label: "亲近", points: 250, next: 250, effect: "专属特效", detail: "随卡面浮动的粒子与动态光照" } as RelationshipSample;
const LV4_300: RelationshipProgress = { points: 300, level: 4, label: "亲近", effect: "专属特效", nextThreshold: 500, progress: 20 };
const LV5_500: RelationshipProgress = { points: 500, level: 5, label: "相依", effect: "镀闪卡面", nextThreshold: null, progress: 100 };

test("Lv4 at 300 points shows the remaining points and never claims the top level", () => {
  assert.equal(nextStageText(LV4_300), "下一阶段还需 200 点好感");
  assert.ok(!nextStageText(LV4_300).includes("最高级"));
  assert.equal(levelIntro(LV4_SAMPLE, LV4_300), "Lv.4 专属特效：随卡面浮动的粒子与动态光照");
});

test("Lv5 at 500 points is the top level and its intro agrees with the Lv.5 label", () => {
  assert.equal(nextStageText(LV5_500), "已解锁最高级镀闪卡面");
  const intro = levelIntro(LV4_SAMPLE, LV5_500);
  assert.match(intro, /^Lv\.5 镀闪卡面/);
  assert.ok(!intro.startsWith("Lv.4"));
  assert.match(intro, /暂按 Lv\.4 显示/);
});

test("the static preview page still describes its own sample", () => {
  assert.equal(levelIntro(LV4_SAMPLE), "Lv.4 专属特效：随卡面浮动的粒子与动态光照");
});
