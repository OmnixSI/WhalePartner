import assert from "node:assert/strict";
import { test } from "node:test";
import { selectKeyframeTimestamps } from "../vendor/dsh-bilibili/lib/keyframes.js";

test("anchors one keyframe to a subtitle segment in each duration bucket", () => {
  const segments = [
    { start: 4, end: 6, text: "开场内容" },
    { start: 28, end: 32, text: "第二段内容" },
    { start: 48, end: 52, text: "第三段内容" },
    { start: 73, end: 77, text: "结尾内容" },
  ];

  const frames = selectKeyframeTimestamps(segments, 80, 4);

  assert.deepEqual(frames.map((frame) => frame.time), [5, 30, 50, 75]);
  assert.deepEqual(frames.map((frame) => frame.reason), Array(4).fill("subtitle aligned"));
  assert.deepEqual(frames.map((frame) => frame.text), segments.map((segment) => segment.text));
});

test("uses even timestamps when the transcript has no segments", () => {
  const frames = selectKeyframeTimestamps([], 100, 4);

  assert.deepEqual(frames.map((frame) => frame.time), [12.5, 37.5, 62.5, 87.5]);
  assert.deepEqual(frames.map((frame) => frame.reason), Array(4).fill("even interval"));
});

test("keeps a frame for a short video", () => {
  const frames = selectKeyframeTimestamps([], 8, 8);

  assert.deepEqual(frames.map((frame) => frame.time), [4]);
});
