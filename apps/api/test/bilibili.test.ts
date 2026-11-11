import assert from "node:assert/strict";
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertBilibiliRequestAllowed, formatBilibiliEvidence, normalizeBilibiliInput, recordBilibiliCooldown } from "../src/bilibili/video.ts";
import { bilibiliCooldownPath } from "../src/server/data-dir.ts";

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

test("a corrupt Bilibili cooldown file stops blocking requests, and cooldowns are written atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whalepartner-bili-cooldown-"));
  const previous = process.env.WP_DATA_DIR;
  process.env.WP_DATA_DIR = directory;
  try {
    const path = bilibiliCooldownPath();
    assert.ok(path.startsWith(directory));
    // 上次写到一半被打断，只留下半截 JSON。
    await writeFile(path, '{"status": -412, "retryAt": "2099-');
    await assertBilibiliRequestAllowed();
    await assert.rejects(access(path));

    const retryAt = new Date(Date.now() + 3_600_000).toISOString();
    await recordBilibiliCooldown({ limited: true, status: -412, retryAt });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { status: -412, retryAt });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(directory), ["bilibili-rate-limit.json"]);
    await assert.rejects(assertBilibiliRequestAllowed(), /暂停视频请求/);
  } finally {
    if (previous === undefined) delete process.env.WP_DATA_DIR;
    else process.env.WP_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
