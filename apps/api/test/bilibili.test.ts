import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBilibiliEvidence, normalizeBilibiliInput } from "../src/bilibili/video.ts";

const bvid = "BV1d8pU6xEZX";

test("accepts Bilibili video links and short links only", () => {
  assert.equal(normalizeBilibiliInput(bvid), bvid);
  assert.equal(normalizeBilibiliInput(`https://www.bilibili.com/video/${bvid}?p=1`), bvid);
  assert.equal(normalizeBilibiliInput("http://b23.tv/short"), "https://b23.tv/short");
  assert.throws(() => normalizeBilibiliInput("https://example.com/video/BV1d8pU6xEZX"));
});

test("formats video evidence with transcript and visual frames as primary evidence", () => {
  const formatted = formatBilibiliEvidence({
    bvid,
    canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
    metadata: {
      title: "视频标题",
      description: "视频简介",
      uploader: { name: "视频作者" },
      duration: 120,
    },
    transcript: {
      source: "subtitle",
      language: "中文",
      text: "字幕开头。字幕结尾。",
      segments: [
        { start: 1, end: 2, text: "字幕开头。" },
        { start: 116, end: 119, text: "字幕结尾。" },
      ],
    },
    comments: {
      total: 1,
      fetched: 1,
      comments: [{ content: "观众的辅助观点", likes: 3 }],
      note: "",
    },
    danmaku: {
      total: 1,
      samples: [{ time: 12, text: "观众弹幕" }],
    },
    frameImages: [{
      time: 30,
      reason: "even interval",
      transcriptContext: "字幕片段",
      path: "/tmp/frame_001.jpg",
    }],
  });

  assert.match(formatted, /标题：视频标题/);
  assert.match(formatted, /时长：02:00/);
  assert.match(formatted, /\[00:01\] 字幕开头/);
  assert.match(formatted, /附图 1：00:30/);
  assert.match(formatted, /观众的辅助观点/);
  assert.match(formatted, /仅作观众反应背景，不代表视频事实/);
});

test("marks unavailable transcript and frames as evidence limits", () => {
  const formatted = formatBilibiliEvidence({
    bvid,
    canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
    metadata: {},
    transcript: { source: "none", text: "", note: "字幕需要登录，匿名读取受限" },
    comments: { total: 0, fetched: 0, comments: [], note: "" },
    danmaku: { total: 0, samples: [] },
    frameImages: [],
  });

  assert.match(formatted, /字幕需要登录，匿名读取受限/);
  assert.match(formatted, /没有可供模型分析的关键帧图像/);
});
