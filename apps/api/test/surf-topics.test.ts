import assert from "node:assert/strict";
import { test } from "node:test";
import { pickTopics, rankVideos, rankWebResults, scoreWebResult, topicsSimilar } from "../src/surf/picker.ts";
import { SurfService } from "../src/surf/service.ts";
import { fakeProvider, fakeVideo, fakeWeb, makeStore, seedChat, videoCandidate, webResult } from "./surf-fakes.ts";

/** 可复现的伪随机。 */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const PERSONA = ["海洋", "鲸歌", "纪录片", "深海生物", "手帐", "治愈系音乐", "星空", "温柔的故事"];

test("选题：近义主题判断", () => {
  assert.ok(topicsSimilar("鲸歌", "座头鲸的鲸歌"));
  assert.ok(topicsSimilar("深海生物", "深海"));
  assert.ok(!topicsSimilar("星空", "手帐"));
});

test("选题结合人设、用户设置、最近聊天三路来源", () => {
  const topics = pickTopics({
    personaInterests: PERSONA,
    userInterests: ["咖啡"],
    recentTopics: ["考研"],
    blocked: [],
    random: seeded(1),
  });
  assert.ok(topics.includes("考研"), "最近聊到的话题要排得上");
  assert.ok(topics.includes("咖啡"), "用户补充的兴趣要排得上");
  assert.ok(topics.some((topic) => PERSONA.includes(topic)), "至少有一个人设兴趣");
  assert.ok(topics.length >= 3 && topics.length <= 5);
});

test("选题多样性：刚逛过的主题连着出现的概率被压得很低", () => {
  const history = [["鲸歌", "海洋"], ["纪录片", "手帐"]];
  let repeated = 0;
  let total = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const topics = pickTopics({ personaInterests: PERSONA, userInterests: [], recentTopics: [], blocked: [], history, random: seeded(seed) });
    // 头两位是视频会用的话题
    for (const topic of topics.slice(0, 2)) {
      total += 1;
      if (history[0].some((used) => topicsSimilar(topic, used))) repeated += 1;
    }
  }
  assert.ok(repeated / total < 0.12, `上一次的主题不该总出现在头两位（${repeated}/${total}）`);
});

test("选题多样性：同一批里不放两个相近的主题", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const topics = pickTopics({
      personaInterests: ["海洋", "海洋生物", "深海生物", "深海", "星空"],
      userInterests: [],
      recentTopics: ["海洋纪录片"],
      blocked: [],
      random: seeded(seed),
    });
    for (let i = 0; i < topics.length; i += 1) {
      for (let j = i + 1; j < topics.length; j += 1) {
        assert.ok(!topicsSimilar(topics[i], topics[j]), `${topics[i]} 与 ${topics[j]} 太像`);
      }
    }
  }
});

test("选题：屏蔽词过滤、全空回退人格兴趣", () => {
  const topics = pickTopics({ personaInterests: ["赌博", "海洋"], userInterests: [], recentTopics: [], blocked: ["赌博"], random: seeded(3) });
  assert.ok(!topics.includes("赌博"));
  const fallback = pickTopics({ personaInterests: ["赌博"], userInterests: [], recentTopics: [], blocked: ["赌博"], random: seeded(3) });
  assert.ok(fallback.length >= 1);
});

test("连续多次会话：相邻两次的头两个主题几乎不重叠", async () => {
  const { store, path } = makeStore();
  seedChat(path);
  const now = new Date(2026, 10, 7, 10, 0, 0);
  const service = new SurfService({
    store,
    provider: fakeProvider().provider,
    web: fakeWeb({ fixed: false }),
    video: fakeVideo(),
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    now: () => now,
  });
  const previous: string[][] = [];
  let overlaps = 0;
  const rounds = 8;
  for (let round = 0; round < rounds; round += 1) {
    const result = await service.run("whale", { slot: `2026-11-07 slot-${round}`, now });
    assert.notEqual(result.state, "skipped");
    const session = store.session(result.sessionId!)!;
    const last = previous.at(-1);
    if (last) {
      const head = session.queries.slice(0, 2);
      if (head.some((topic) => last.slice(0, 2).some((used) => topicsSimilar(topic, used)))) overlaps += 1;
    }
    previous.push(session.queries);
  }
  // 没有多样性时，8 个人格兴趣里取头两位，相邻两次几乎总会撞上；有了之后偶尔才会。
  assert.ok(overlaps <= 2, `相邻会话头两位重叠了 ${overlaps}/${rounds - 1} 次`);
  store.close();
});

test("搜索结果先按标题和摘要打分：相关、有摘要的靠前，标题党和文档垃圾沉底", () => {
  const results = [
    webResult({ title: "震惊！99%的人都不知道", url: "https://spam.example.com/a", snippet: "点击领取优惠" }),
    webResult({ title: "鲸歌是什么：座头鲸为什么唱歌", url: "https://sspai.com/post/1", snippet: "科普座头鲸的鲸歌如何传播，研究者用水听器记录了三十年的变化。" }),
    webResult({ title: "鲸歌资料", url: "https://example.com/file.pdf", snippet: "" }),
    webResult({ title: "完全无关的内容标题", url: "https://example.org/x", snippet: "与话题无关的一段较长摘要文字，用来占位置，凑够四十个字符以上才行。" }),
  ];
  const ranked = rankWebResults(results, { topics: ["鲸歌"] }, 6);
  assert.equal(ranked[0].url, "https://sspai.com/post/1");
  assert.ok(!ranked.some((item) => item.url.includes("spam.example")), "标题党被剔除");
  assert.ok(scoreWebResult(results[1], { topics: ["鲸歌"] }) > scoreWebResult(results[3], { topics: ["鲸歌"] }));
  const plain = scoreWebResult(results[1], { topics: ["鲸歌"] });
  const seenBefore = scoreWebResult(results[1], { topics: ["鲸歌"], recentTitles: ["鲸歌是什么：座头鲸为什么唱歌"] });
  assert.ok(plain - seenBefore >= 2, "刚看过同题材的要扣分");
});

test("视频候选打分：播放量、时长、话题贴合度", () => {
  const ranked = rankVideos(
    [
      videoCandidate({ bvid: "BV1aaaaaaaa1", title: "无关视频", play: 6000, durationSeconds: 90 }),
      videoCandidate({ bvid: "BV1aaaaaaaa2", title: "鲸歌的秘密", play: 900000, durationSeconds: 420 }),
    ],
    { topics: ["鲸歌"] },
  );
  assert.equal(ranked[0].bvid, "BV1aaaaaaaa2");
});
