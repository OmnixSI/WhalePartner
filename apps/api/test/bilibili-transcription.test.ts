import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { extractAll } from "../vendor/dsh-bilibili/lib/extractor.js";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("uses Bilibili Bcut ASR when the platform subtitle track has no text", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; method: string; cookie?: string }> = [];
  const framesDir = await mkdtemp(join(tmpdir(), "whalepartner-asr-test-"));
  globalThis.fetch = async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);
    requests.push({
      url,
      method: init?.method ?? "GET",
      cookie: new Headers(init?.headers).get("Cookie") ?? undefined,
    });

    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/web-interface/wbi/view") {
      return jsonResponse({
        code: 0,
        data: {
          title: "无字幕测试视频",
          desc: "简介",
          owner: { name: "作者", mid: 1 },
          duration: 90,
          pubdate: 1700000000,
          tname: "知识",
          cid: 9,
          aid: 8,
          pages: [{ cid: 9 }],
          stat: { view: 10, like: 1, reply: 0, danmaku: 0 },
        },
      });
    }
    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/web-interface/nav") {
      return jsonResponse({ code: 0, data: { wbi_img: {
        img_url: `https://i0.hdslb.com/${"a".repeat(64)}.png`,
        sub_url: `https://i0.hdslb.com/${"b".repeat(64)}.png`,
      } } });
    }
    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/player/wbi/v2") {
      return jsonResponse({ code: 0, data: { subtitle: { subtitles: [
        { lan: "zh-CN", lan_name: "中文", subtitle_url: "https://subtitle.test/empty.json" },
      ] } } });
    }
    if (url.hostname === "subtitle.test") return jsonResponse({ body: [] });
    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/v2/reply") {
      return jsonResponse({ code: 0, data: { page: { count: 0 }, replies: [] } });
    }
    if (url.hostname === "comment.bilibili.com") return new Response("<i></i>", { status: 200 });
    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/player/playurl") {
      return jsonResponse({ code: 0, data: { dash: { audio: [{ baseUrl: "https://audio.test/stream.m4s" }] } } });
    }
    if (url.hostname === "member.bilibili.com" && url.pathname.endsWith("/task")) {
      return jsonResponse({ code: 0, data: { task_id: "test-task" } });
    }
    if (url.hostname === "member.bilibili.com" && url.pathname.endsWith("/task/result")) {
      return jsonResponse({
        code: 0,
        data: {
          state: 4,
          result: JSON.stringify({ utterances: [{ start_time: 1200, end_time: 3500, transcript: "必剪转写正文" }] }),
        },
      });
    }
    throw new Error(`Unexpected request in the Bcut ASR test: ${url.href}`);
  };

  try {
    const result = await extractAll({
      url: "BV1d8pU6xEZX",
      framesDir,
      extractFrames: false,
      asrProvider: "bcut",
      sessdata: "local-test-session",
    });

    assert.equal(result.success, true);
    assert.equal(result.transcript.source, "bcut-asr");
    assert.equal(result.transcript.text, "必剪转写正文");
    assert.deepEqual(result.transcript.segments, [{ start: 1.2, end: 3.5, text: "必剪转写正文" }]);
    assert.equal(requests.some((request) => request.url.hostname === "audio.test"), false);
    assert.equal(requests.some((request) => request.cookie === "SESSDATA=local-test-session"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(framesDir, { recursive: true, force: true });
  }
});
