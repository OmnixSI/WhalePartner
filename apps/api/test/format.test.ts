import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExtraction, pickDanmakuPeaks } from "../vendor/dsh-bilibili/lib/format.js";

test("keeps distinct danmaku text within each selected time window", () => {
  const samples = [
    { time: 1, text: "六周年快乐" },
    { time: 1.5, text: "六周年快乐" },
    { time: 2, text: "风的来信" },
    { time: 61, text: "六周年快乐" },
    { time: 62, text: "旅途有你" },
  ];

  const picked = pickDanmakuPeaks(samples, 60, 2, 10);

  assert.deepEqual(picked.map((sample) => sample.text), [
    "六周年快乐",
    "风的来信",
    "六周年快乐",
    "旅途有你",
  ]);
});

test("keeps repeated danmaku counts without resending the same text as a timeline sample", () => {
  const formatted = formatExtraction({
    success: true,
    bvid: "BV1d8pU6xEZX",
    metadata: { title: "测试视频", uploader: { name: "作者" }, duration: 60, stats: { danmaku: 10 } },
    transcript: { text: "", note: "no subtitle" },
    danmaku: {
      total: 5,
      top_messages: [{ text: "重复祝福", count: 4 }],
      samples: [
        { time: 1, text: "重复祝福" },
        { time: 2, text: "重复祝福" },
        { time: 5, text: "独特观点" },
      ],
    },
    comments: {},
    frames: { enabled: false },
    elapsed_seconds: 1,
  });

  assert.match(formatted, /\[重复祝福\] x4/);
  assert.match(formatted, /Timeline samples:\n  0:05 独特观点/);
  assert.doesNotMatch(formatted, /Timeline samples:\n  0:01 重复祝福/);
});
