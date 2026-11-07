import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyNormalizeUrl, normalizeUrl, webDedupeKey, webDedupeKeys } from "../src/surf/picker.ts";
import { assertReadable, contentFingerprint, extractArticle } from "../src/surf/reader.ts";
import { SurfService } from "../src/surf/service.ts";
import { fakeProvider, fakeVideo, fakeWeb, makeStore, webResult } from "./surf-fakes.ts";
import type { WebPageText, WebSource } from "../src/surf/types.ts";

test("URL 规范化：同一篇的各种写法得到同一个键", () => {
  const variants = [
    "https://www.Example.com/post/1/",
    "http://example.com/post/1",
    "https://example.com/post/1?utm_source=wechat&utm_medium=social#comments",
    "https://example.com:443/post/1/?spm=a2.b.c&fbclid=xyz",
    "https://m.example.com//post/1/index.html",
  ];
  const keys = new Set(variants.map(webDedupeKey));
  assert.equal(keys.size, 1, `这些写法应是同一个键：${[...keys].join(" / ")}`);
  // 真正影响内容的参数保留，且与顺序无关
  assert.equal(normalizeUrl("https://example.com/p?b=2&a=1"), normalizeUrl("https://example.com/p?a=1&b=2"));
  assert.notEqual(webDedupeKey("https://example.com/p?id=1"), webDedupeKey("https://example.com/p?id=2"));
});

test("老数据的去重键仍然认得：新旧两种算法的键都会比对", () => {
  const url = "https://Example.com/a/b/?utm_source=x&id=1#frag";
  const keys = webDedupeKeys(url);
  assert.equal(keys.length, 2);
  assert.ok(keys[1].startsWith("web:"));
  assert.equal(legacyNormalizeUrl(url), "https://example.com/a/b?id=1");
});

test("网页链到 B 站视频页，和搜到的视频是同一个去重键", () => {
  assert.equal(webDedupeKey("https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333"), "bv:BV1xx411c7mD");
});

const ARTICLE_A = `<html><head><title>深海里的歌 - 海洋志</title></head><body>
<nav><a href="/">首页</a><a href="/x">专栏</a></nav>
<article><h1>深海里的歌</h1>${"<p>座头鲸会唱很长很复杂的歌，一首歌可以持续二十分钟，同一片海域的鲸会逐渐唱成同一首。</p>".repeat(6)}</article>
<div class="advert">立即领取优惠券</div><footer>版权所有</footer></body></html>`;
// 转载：换了站点、加了一段广告和不同的页脚，正文一样
const ARTICLE_B = `<html><head><title>【转载】深海里的歌</title></head><body>
<div class="sidebar">热门推荐 热门推荐</div>
<article><h1>【转载】深海里的歌</h1>${"<p>座头鲸会唱很长很复杂的歌，一首歌可以持续二十分钟，同一片海域的鲸会逐渐唱成同一首。</p>".repeat(6)}<p>转载自海洋志</p></article>
<footer>另一个页脚</footer></body></html>`;

test("正文提取：去掉导航、广告、页脚；内容指纹认得转载", () => {
  const a = extractArticle(ARTICLE_A, "https://a.example.com/x");
  const b = extractArticle(ARTICLE_B, "https://b.example.org/y");
  assert.doesNotMatch(a.text, /首页|专栏|立即领取|版权所有/);
  assert.match(a.text, /座头鲸会唱很长很复杂的歌/);
  assertReadable(a);
  assert.ok(contentFingerprint(a.text).length === 16);
  assert.equal(contentFingerprint(a.text), contentFingerprint(b.text), "转载的同一篇正文，指纹相同");
  assert.notEqual(contentFingerprint(a.text), contentFingerprint("完全不同的一篇文章。".repeat(30)));
  assert.equal(contentFingerprint("太短"), "", "太短的文字不做指纹，免得误判");
});

test("正文太短或像目录页：判为读不了", () => {
  const short = extractArticle("<html><body><p>你好</p></body></html>", "https://x.com/a");
  assert.throws(() => assertReadable(short), /没有读到足够的文字/);
});

function webWithText(text: (url: string) => string): WebSource {
  const base = fakeWeb({ fixed: false });
  return {
    ...base,
    async read(url): Promise<WebPageText> {
      return { url, title: `页面 ${url}`, text: text(url), siteName: new URL(url).hostname };
    },
  };
}

test("跨天去重：换了链接的同一篇正文，第二天不会再记一遍", async () => {
  const { store } = makeStore();
  const day1 = new Date(2026, 10, 6, 10, 0, 0);
  const day2 = new Date(2026, 10, 7, 10, 0, 0);
  const sameBody = "座头鲸的歌会在整片海域里慢慢传开，每年都有新的乐句出现，研究者用水听器记录了三十年。".repeat(8);
  let clock = day1;
  const service = new SurfService({
    store,
    provider: fakeProvider().provider,
    web: webWithText(() => sameBody),
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    now: () => clock,
  });
  store.putSettings("whale", { video: false }, day1.toISOString());
  const first = await service.run("whale", { manual: true });
  assert.equal(first.state, "done");
  const firstCount = store.feed({ character: "whale", page: 1, pageSize: 50 }).total;
  assert.equal(firstCount, 1, "同一天里两个链接正文一样，只留一条");

  clock = day2;
  const second = await service.run("whale", { manual: true });
  assert.equal(second.items, 0, "第二天遇到同样的正文（哪怕是新链接）不再入库");
  assert.equal(store.feed({ character: "whale", page: 1, pageSize: 50 }).total, firstCount);
  store.close();
});

test("被「忘掉」的内容，换个链接再遇到也不会逛回来", async () => {
  const { store } = makeStore();
  const now = new Date(2026, 10, 7, 10, 0, 0);
  const body = "这是一篇被她读过又被忘掉的文章，里面讲的是潮汐如何影响浅滩上的小生物。".repeat(8);
  const service = new SurfService({
    store,
    provider: fakeProvider().provider,
    web: webWithText(() => body),
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    now: () => now,
  });
  store.putSettings("whale", { video: false }, now.toISOString());
  await service.run("whale", { manual: true });
  const [item] = store.feed({ character: "whale", page: 1, pageSize: 5 }).items;
  await service.forget(item.id);
  const later = new Date(2026, 10, 8, 10, 0, 0);
  const again = new SurfService({
    store,
    provider: fakeProvider().provider,
    web: webWithText(() => body),
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    now: () => later,
  });
  const result = await again.run("whale", { manual: true });
  assert.equal(result.items, 0);
  store.close();
});

test("搜索结果里已看过的链接（不同写法）会被滤掉", async () => {
  const { store } = makeStore();
  const now = new Date(2026, 10, 7, 10, 0, 0);
  const web = fakeWeb({ fixed: true });
  web.search = async () => [
    webResult({ url: "https://example.com/a?utm_source=feed", title: "鲸歌是什么 新写法" }),
    webResult({ url: "https://example.org/b", title: "鲸歌二" }),
  ];
  const service = new SurfService({
    store,
    provider: fakeProvider().provider,
    web,
    thumbs: { fetch: async () => null },
    navGap: () => 0,
    now: () => now,
  });
  store.putSettings("whale", { video: false }, now.toISOString());
  // 以前用旧算法记下了 example.com/a
  const { session } = store.startSession("whale", "old", now.toISOString());
  store.insertItem({
    character: "whale", sessionId: session.id, kind: "web", title: "旧", url: "https://example.com/a", sourceSite: "example.com",
    summary: "旧的摘要，已经逛过了。", comment: "嗯", tags: [], score: 3, dedupeKey: webDedupeKeys("https://example.com/a")[1], createdAt: now.toISOString(),
  });
  await service.run("whale", { manual: true });
  assert.ok(!web.reads.some((url) => url.includes("example.com/a")), "旧键对得上的页面不该再读");
  store.close();
});
