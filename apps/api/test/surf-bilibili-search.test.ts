import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bilibiliCooldownPath } from "../src/data-dir.ts";
import { createBilibiliVideoSource, durationSeconds, mixinKey, parseSearchPayload, signWbi } from "../src/surf/bilibili-source.ts";

/** 录下来的搜索返回（裁剪成最小结构，字段名与线上一致）。 */
const FIXTURE = {
  code: 0,
  message: "0",
  data: {
    page: 1,
    result: [
      {
        bvid: "BV1xx411c7mD",
        title: '深海里的<em class="keyword">鲸歌</em>',
        author: "海洋频道",
        duration: "12:34",
        play: 23456,
        description: "一段水下录音",
        pic: "//i0.hdslb.com/bfs/archive/abc.jpg",
      },
      { bvid: "不是BV号", title: "坏的", duration: "1:00", play: 99999 },
      { bvid: "BV1yy411c7mE", title: "只有秒数", duration: 95, play: 8000, author: "B", description: "", pic: "" },
    ],
  },
};

test("搜索解析：去 <em>、时长换算、pic 补协议、坏 BV 丢掉", () => {
  const candidates = parseSearchPayload(FIXTURE);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0], {
    bvid: "BV1xx411c7mD",
    title: "深海里的鲸歌",
    author: "海洋频道",
    durationSeconds: 754,
    play: 23456,
    description: "一段水下录音",
    pic: "https://i0.hdslb.com/bfs/archive/abc.jpg",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
  });
  assert.equal(candidates[1].durationSeconds, 95);
});

test("搜索解析：非 0 code 直接报错（不编数据）", () => {
  assert.throws(() => parseSearchPayload({ code: -412, message: "请求被拦截" }), /请求被拦截/);
  assert.throws(() => parseSearchPayload(null), /没有返回内容/);
});

test("时长解析", () => {
  assert.equal(durationSeconds("00:59"), 59);
  assert.equal(durationSeconds("1:00:00"), 3600);
  assert.equal(durationSeconds("不是时间"), 0);
  assert.equal(durationSeconds(30), 30);
});

test("WBI 签名：mixin key 长度 32，签名带 w_rid", () => {
  const key = mixinKey("0123456789abcdef0123456789abcdef", "fedcba9876543210fedcba9876543210");
  assert.equal(key.length, 32);
  const signed = signWbi({ keyword: "鲸歌", page: 1, search_type: "video" }, key, 1700000000);
  assert.equal(signed.wts, "1700000000");
  assert.match(signed.w_rid, /^[0-9a-f]{32}$/);
  const again = signWbi({ keyword: "鲸歌", page: 1, search_type: "video" }, key, 1700000000);
  assert.equal(again.w_rid, signed.w_rid, "同样输入签名稳定");
});

test("搜索：走假 fetchJson，不连外网；请求带签名和关键词", async () => {
  const urls: string[] = [];
  const source = createBilibiliVideoSource({
    fetchJson: async (url) => {
      urls.push(url);
      if (url.includes("/x/web-interface/nav")) {
        return { code: 0, data: { wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/aaaa.png", sub_url: "https://i0.hdslb.com/bfs/wbi/bbbb.png" } } };
      }
      return FIXTURE;
    },
    now: () => 1_700_000_000,
  });
  const results = await source.search("鲸歌");
  assert.equal(results.length, 2);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /search\/type\?/);
  assert.match(urls[1], /keyword=%E9%B2%B8%E6%AD%8C/);
  assert.match(urls[1], /w_rid=[0-9a-f]{32}/);
  assert.match(urls[1], /order=totalrank/);
});

test("限流冷却期：不发任何请求（冷却文件在数据目录里）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wp-bili-"));
  const previous = process.env.WP_DATA_DIR;
  process.env.WP_DATA_DIR = dir;
  try {
    const ratePath = bilibiliCooldownPath();
    assert.ok(ratePath.startsWith(dir), "冷却文件必须在数据目录下");
    await writeFile(ratePath, JSON.stringify({ status: -412, retryAt: new Date(Date.now() + 3600_000).toISOString() }));
    let called = 0;
    const source = createBilibiliVideoSource({
      fetchJson: async () => {
        called += 1;
        return FIXTURE;
      },
    });
    await assert.rejects(() => source.search("鲸歌"), /暂停视频请求/);
    assert.equal(called, 0);
  } finally {
    if (previous === undefined) delete process.env.WP_DATA_DIR;
    else process.env.WP_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
