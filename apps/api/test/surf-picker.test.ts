import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BV_KEY,
  filterCandidates,
  filterWebResults,
  normalizeUrl,
  parseVideoPick,
  parseWebPicks,
  pickTopics,
  webDedupeKey,
  webQueryFor,
} from "../src/surf/picker.ts";
import { containsBlocked, isBlockedHost, mergeBlocked } from "../src/surf/blocklist.ts";
import { inQuietHours, validateSettingsPatch, SurfSettingsError } from "../src/surf/settings.ts";
import { videoCandidate, webResult } from "./surf-fakes.ts";

const seeded = (values: number[]) => {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
};

test("pickTopics：2 个人格兴趣 + 用户补充 + 近期话题，去掉重复与屏蔽词", () => {
  const topics = pickTopics({
    personaInterests: ["海洋", "鲸歌", "纪录片", "深海生物", "手帐"],
    userInterests: ["养猫"],
    recentTopics: ["面试"],
    blocked: ["鲸歌"],
    random: seeded([0]),
  });
  assert.ok(topics.length >= 1 && topics.length <= 5);
  assert.ok(!topics.includes("鲸歌"), "命中屏蔽词的不取");
  assert.equal(new Set(topics).size, topics.length, "不重复");
});

test("pickTopics：全被屏蔽词吃掉时回退到人格兴趣，保证至少 1 个", () => {
  const topics = pickTopics({
    personaInterests: ["海洋", "鲸歌"],
    userInterests: [],
    recentTopics: [],
    blocked: ["海洋", "鲸歌"],
    random: seeded([0.3]),
  });
  assert.equal(topics.length, 2);
  assert.deepEqual(topics.sort(), ["海洋", "鲸歌"].sort());
});

test("pickTopics：什么输入都没有也至少给一个", () => {
  const topics = pickTopics({ personaInterests: [], userInterests: [], recentTopics: [], blocked: [] });
  assert.equal(topics.length, 1);
});

test("网页搜索词带后缀", () => {
  assert.match(webQueryFor("鲸歌", () => 0), /^鲸歌 (是什么|最新|有趣的事|入门)$/);
});

test("filterCandidates：时长、播放量边界", () => {
  const candidates = [
    videoCandidate({ bvid: "BV0000000001", durationSeconds: 59 }),
    videoCandidate({ bvid: "BV0000000002", durationSeconds: 60 }),
    videoCandidate({ bvid: "BV0000000003", durationSeconds: 1201 }),
    videoCandidate({ bvid: "BV0000000004", durationSeconds: 1200 }),
    videoCandidate({ bvid: "BV0000000005", play: 4999 }),
    videoCandidate({ bvid: "BV0000000006", play: 5000 }),
  ];
  const kept = filterCandidates(candidates, { blocked: [], seen: [] }).map((item) => item.bvid);
  assert.deepEqual(kept, ["BV0000000002", "BV0000000004", "BV0000000006"]);
});

test("filterCandidates：屏蔽词与去重（含用户分享过的 bili: 经验）", () => {
  const candidates = [
    videoCandidate({ bvid: "BV0000000010", title: "赌场实录" }),
    videoCandidate({ bvid: "BV0000000011", title: "安静的深海" }),
    videoCandidate({ bvid: "BV0000000012", title: "已经被她逛过" }),
  ];
  const kept = filterCandidates(candidates, {
    blocked: mergeBlocked(["赌场"]),
    seen: [BV_KEY("BV0000000012")],
  });
  assert.deepEqual(kept.map((item) => item.bvid), ["BV0000000011"]);
});

test("filterCandidates：最多留 8 个", () => {
  const candidates = Array.from({ length: 20 }, (_, index) => videoCandidate({ bvid: `BV${String(index).padStart(10, "0")}` }));
  assert.equal(filterCandidates(candidates, { blocked: [], seen: [] }).length, 8);
});

test("normalizeUrl / webDedupeKey：去掉 utm_*、#、末尾斜杠", () => {
  assert.equal(normalizeUrl("https://Example.com/a/b/?utm_source=x&id=1#frag"), "example.com/a/b?id=1");
  assert.equal(normalizeUrl("https://example.com/a/"), "example.com/a");
  assert.equal(webDedupeKey("https://example.com/a?utm_medium=y"), webDedupeKey("https://example.com/a"));
  assert.notEqual(webDedupeKey("https://example.com/a"), webDedupeKey("https://example.com/b"));
  assert.match(webDedupeKey("https://example.com/a"), /^web:[0-9a-f]{16}$/);
});

test("filterWebResults：登录墙、私网、同域名每日 2 次、去重", () => {
  const results = [
    webResult({ url: "https://weibo.com/a" }),
    webResult({ url: "https://m.zhihu.com/b" }),
    webResult({ url: "http://127.0.0.1/c" }),
    webResult({ url: "https://10.0.0.1/d" }),
    webResult({ url: "ftp://example.com/e" }),
    webResult({ url: "https://example.com/f" }),
    webResult({ url: "https://example.com/f?utm_source=1" }),
    webResult({ url: "https://other.example/g" }),
    webResult({ url: "https://third.example/h" }),
  ];
  const kept = filterWebResults(results, {
    blocked: [],
    seen: [],
    hostCounts: { "third.example": 2 },
    isPublic: (host) => !host.startsWith("10.") && host !== "127.0.0.1",
  });
  // example.com 只留一条（规范化后重复），other.example 可留，third.example 当天已满 2 次
  assert.deepEqual(kept.map((item) => item.url), ["https://example.com/f", "https://other.example/g"]);
});

test("filterWebResults：www. 域名和入库的 source_site 一起计每日次数", () => {
  const results = [
    webResult({ url: "https://www.example.com/a" }),
    webResult({ url: "https://www.other.example/b" }),
    webResult({ url: "https://other.example/c" }),
    webResult({ url: "https://www.other.example/d" }),
  ];
  const kept = filterWebResults(results, {
    blocked: [],
    seen: [],
    // 入库时 siteOf() 已经去掉了 www.
    hostCounts: { "example.com": 2 },
    isPublic: () => true,
  });
  assert.deepEqual(kept.map((item) => item.url), ["https://www.other.example/b", "https://other.example/c"]);
});

test("decode 与挑选解析：解析失败取第一个", () => {
  assert.equal(parseVideoPick('{"index":2}', 3), 2);
  assert.equal(parseVideoPick('```json\n{"index":1}\n```', 3), 1);
  assert.equal(parseVideoPick("我看不懂", 3), 0);
  assert.equal(parseVideoPick('{"index":9}', 3), 0);
  assert.deepEqual(parseWebPicks('{"picks":[{"index":0},{"index":1},{"index":1},{"index":2}]}', 3), [0, 1, 2]);
  assert.deepEqual(parseWebPicks("坏的", 2), [0]);
});

test("屏蔽表：内置词与域名", () => {
  const words = mergeBlocked(["自定词"]);
  assert.ok(words.includes("自定词"));
  assert.ok(words.includes("赌博"));
  assert.equal(containsBlocked("这里在讲赌博", mergeBlocked([])), "赌博");
  assert.equal(containsBlocked("很正常的科普", mergeBlocked([])), null);
  assert.equal(isBlockedHost("m.weibo.com"), true);
  assert.equal(isBlockedHost("example.com"), false);
});

test("静默时段：跨午夜与边界", () => {
  const quiet = { start: "23:00", end: "08:00" };
  assert.equal(inQuietHours(quiet, new Date(2026, 10, 7, 23, 30)), true);
  assert.equal(inQuietHours(quiet, new Date(2026, 10, 7, 3, 0)), true);
  assert.equal(inQuietHours(quiet, new Date(2026, 10, 7, 8, 0)), false);
  assert.equal(inQuietHours(quiet, new Date(2026, 10, 7, 12, 0)), false);
  const day = { start: "13:00", end: "15:00" };
  assert.equal(inQuietHours(day, new Date(2026, 10, 7, 14, 0)), true);
  assert.equal(inQuietHours(day, new Date(2026, 10, 7, 15, 0)), false);
});

test("设置校验：每类非法输入都报错", () => {
  assert.throws(() => validateSettingsPatch({ frequency: "常常" }), SurfSettingsError);
  assert.throws(() => validateSettingsPatch({ interests: Array.from({ length: 9 }, (_, i) => `兴趣${i}`) }), SurfSettingsError);
  assert.throws(() => validateSettingsPatch({ interests: ["这个兴趣实在是太长了超过了十二个字"] }), SurfSettingsError);
  assert.throws(() => validateSettingsPatch({ blocked: Array.from({ length: 21 }, (_, i) => `词${i}`) }), SurfSettingsError);
  assert.throws(() => validateSettingsPatch({ quiet: { start: "25:00" } }), SurfSettingsError);
  assert.throws(() => validateSettingsPatch({ quiet: "晚上" }), SurfSettingsError);
  assert.throws(() => validateSettingsPatch({ enabled: "开" }), SurfSettingsError);
  const ok = validateSettingsPatch({ frequency: "rare", interests: ["鲸歌"], quiet: { start: "22:00" }, video: false });
  assert.deepEqual(ok, { frequency: "rare", interests: ["鲸歌"], quiet: { start: "22:00" }, video: false });
});
