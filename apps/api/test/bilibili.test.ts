import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBilibiliText, normalizeBilibiliInput } from "../src/bilibili.ts";

const bvid = "BV1d8pU6xEZX";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function metadataResponse() {
  return jsonResponse({
    code: 0,
    data: {
      title: "测试视频标题",
      desc: "视频简介",
      owner: { name: "作者", mid: 123 },
      duration: 120,
      pubdate: 1700000000,
      tname: "知识",
      cid: 9,
      aid: 8,
      pages: [{ cid: 9 }],
      stat: { view: 100, like: 10, reply: 2, danmaku: 1 },
    },
  });
}

async function withMockBilibili(
  subtitleAvailable: boolean,
  action: (requests: string[], cookies: Array<string | undefined>) => Promise<void>,
  danmakuXml = '<i><d p="12.4,1,25,16777215,1700000000,0,abc,0">弹幕观点</d></i>',
) {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const cookies: Array<string | undefined> = [];
  globalThis.fetch = async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);
    requests.push(url.href);
    cookies.push(new Headers(init?.headers).get("Cookie") ?? undefined);

    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/web-interface/wbi/view") {
      return metadataResponse();
    }
    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/web-interface/view") {
      return metadataResponse();
    }
    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/web-interface/nav") {
      const keyA = "a".repeat(64);
      const keyB = "b".repeat(64);
      return jsonResponse({
        code: 0,
        data: { wbi_img: { img_url: `https://i0.hdslb.com/${keyA}.png`, sub_url: `https://i0.hdslb.com/${keyB}.png` } },
      });
    }
    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/player/wbi/v2") {
      const subtitles = subtitleAvailable
        ? [{ lan: "zh-CN", lan_name: "中文", subtitle_url: "https://subtitle.test/data.json" }]
        : [];
      return jsonResponse({ code: 0, data: { subtitle: { subtitles } } });
    }
    if (url.hostname === "subtitle.test") {
      return jsonResponse({ body: [{ from: 1, to: 3, content: "字幕中的要点" }] });
    }
    if (url.hostname === "api.bilibili.com" && url.pathname === "/x/v2/reply") {
      return jsonResponse({
        code: 0,
        data: {
          page: { count: 1 },
          replies: [{
            member: { uname: "评论用户" },
            content: { message: "观众评论内容" },
            like: 4,
            replies: [{ member: { uname: "回复用户" }, content: { message: "回复内容" }, like: 1 }],
          }],
        },
      });
    }
    if (url.hostname === "comment.bilibili.com") {
      return new Response(danmakuXml, { status: 200 });
    }
    throw new Error(`Unexpected request in the text-only extractor test: ${url.href}`);
  };

  try {
    await action(requests, cookies);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("accepts Bilibili video links and short links only", () => {
  assert.equal(normalizeBilibiliInput(bvid), bvid);
  assert.equal(normalizeBilibiliInput(`https://www.bilibili.com/video/${bvid}?p=1`), bvid);
  assert.equal(normalizeBilibiliInput("http://b23.tv/short"), "https://b23.tv/short");
  assert.throws(() => normalizeBilibiliInput("https://example.com/video/BV1d8pU6xEZX"));
});

test("reuses public metadata, subtitle, comment, and danmaku extraction without media or ASR", async () => {
  await withMockBilibili(true, async (requests) => {
    const result = await collectBilibiliText(bvid);

    assert.equal(result.bvid, bvid);
    assert.equal(result.metadata?.title, "测试视频标题");
    assert.equal(result.transcript.text, "字幕中的要点");
    assert.equal(result.comments.comments[0].user, "观众");
    assert.equal(result.formattedText.includes("观众评论内容"), true);
    assert.equal(result.formattedText.includes("弹幕观点"), true);
    const metadataUrl = requests.find((url) => new URL(url).pathname === "/x/web-interface/wbi/view");
    assert.ok(metadataUrl);
    assert.equal(new URL(metadataUrl).searchParams.get("bvid"), bvid);
    assert.match(new URL(metadataUrl).searchParams.get("w_rid") ?? "", /^[a-f0-9]{32}$/);
    assert.equal(requests.some((url) => new URL(url).pathname === "/x/web-interface/view"), false);
    assert.deepEqual(result.media, {
      videoDownloaded: false,
      audioDownloaded: false,
      framesExtracted: false,
      asrProvider: "none",
    });
    assert.equal(requests.some((url) => url.includes("/x/v2/reply") && new URL(url).searchParams.get("ps") === "20"), true);
    assert.equal(requests.some((url) => url.includes("/x/player/playurl")), false);
  });
});

test("does not start ASR when the video has no published subtitle", async () => {
  await withMockBilibili(false, async (requests) => {
    const result = await collectBilibiliText(bvid);

    assert.equal(result.transcript.text, "");
    assert.equal(result.transcript.source, "none");
    assert.equal(result.formattedText.includes("观众评论内容"), true);
    assert.equal(requests.some((url) => url.includes("/x/player/playurl")), false);
    assert.equal(requests.some((url) => url.includes("/x/v2/reply")), true);
  });
});

test("uses an optional local SESSDATA for extraction without including it in results", async () => {
  const testSessdata = "local-test-session-value";
  await withMockBilibili(true, async (_requests, cookies) => {
    const result = await collectBilibiliText(bvid, testSessdata);
    assert.equal(cookies.some((cookie) => cookie === `SESSDATA=${testSessdata}`), true);
    assert.equal(JSON.stringify(result).includes(testSessdata), false);
  });
});

test("samples danmaku across the retrieved XML and labels the fetched count", async () => {
  const danmakuXml = `<i>${Array.from({ length: 400 }, (_value, idx) =>
    `<d p="${idx},1,25,16777215,1700000000,0,abc,0">观点${idx}</d>`).join("")}</i>`;

  await withMockBilibili(true, async () => {
    const result = await collectBilibiliText(bvid);

    assert.equal(result.danmaku.samples.length, 200);
    assert.equal(result.danmaku.samples[0].time, 0);
    assert.equal(result.danmaku.samples.at(-1)?.time, 399);
    assert.match(result.formattedText, /Danmaku \(retrieved sample 400; metadata total 1\)/);
  }, danmakuXml);
});
