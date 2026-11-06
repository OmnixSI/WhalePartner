import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createBrowserReader, resolvesPublic } from "../src/surf/browser.ts";
import { filterWebResults } from "../src/surf/picker.ts";
import { decodeBingRedirect, decodeDuckDuckGoRedirect, parseBingResults, parseDuckDuckGoResults, createWebSource } from "../src/surf/web-search.ts";

const b64url = (value: string) => Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const BING_HTML = `
<html><body>
<ol id="b_results">
  <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${b64url("https://example.com/whale-song")}&amp;ntb=1">鲸歌是什么</a></h2>
    <div class="b_caption"><p>讲鲸歌的科普，附录音。</p></div></li>
  <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=def&amp;u=a1${b64url("https://example.org/deep-sea")}">深海里的声音</a></h2>
    <div class="b_caption"><p>一段水下录音。</p></div></li>
  <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1%%%">坏链接</a></h2></li>
</ol>
</body></html>`;

const DDG_HTML = `
<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.net/wave")}&amp;rut=x">浪的声音</a></div>`;

test("Bing 结果解析：跳转链接解回真实地址，坏链接丢掉", () => {
  const results = parseBingResults(BING_HTML);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { title: "鲸歌是什么", url: "https://example.com/whale-song", snippet: "讲鲸歌的科普，附录音。" });
  assert.equal(results[1].url, "https://example.org/deep-sea");
});

test("decodeBingRedirect 正反例", () => {
  const real = "https://example.com/a?b=1";
  assert.equal(decodeBingRedirect(`https://www.bing.com/ck/a?u=a1${b64url(real)}&ntb=1`), real);
  assert.equal(decodeBingRedirect("https://example.com/plain"), "https://example.com/plain");
  assert.equal(decodeBingRedirect("javascript:alert(1)"), null);
  assert.equal(decodeBingRedirect("https://www.bing.com/ck/a?u=a1%%%"), null);
  assert.equal(decodeBingRedirect(""), null);
});

test("DuckDuckGo 回退解析", () => {
  const results = parseDuckDuckGoResults(DDG_HTML);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { title: "浪的声音", url: "https://example.net/wave", snippet: "" });
  assert.equal(decodeDuckDuckGoRedirect("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.net%2Fwave"), "https://example.net/wave");
});

test("搜索：Bing 没结果时回退 DuckDuckGo", async () => {
  const seen: string[] = [];
  const source = createWebSource({
    fetchText: async (url) => {
      seen.push(url);
      if (url.includes("bing.com")) return "<html></html>";
      return DDG_HTML;
    },
    reader: { available: async () => true, read: async () => { throw new Error("不该读"); }, close: async () => {} },
  });
  const results = await source.search("鲸歌");
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.net/wave");
  assert.equal(seen.length, 2);
});

test("SSRF：本机、私网、IPv6 回环都判定为不可读", async () => {
  assert.equal(await resolvesPublic("127.0.0.1"), false);
  assert.equal(await resolvesPublic("10.0.0.1"), false);
  assert.equal(await resolvesPublic("::1"), false);
  assert.equal(await resolvesPublic("localhost"), false);
  assert.equal(await resolvesPublic("192.168.1.1"), false);
  const kept = filterWebResults(
    [
      { title: "a", url: "http://127.0.0.1/x", snippet: "" },
      { title: "b", url: "http://10.0.0.1/y", snippet: "" },
      { title: "c", url: "http://[::1]/z", snippet: "" },
    ],
    { blocked: [], seen: [], isPublic: () => false },
  );
  assert.deepEqual(kept, []);
});

const ARTICLE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>鲸歌笔记</title><meta property="og:image" content="https://example.com/og.jpg">
<meta property="og:site_name" content="深海小站"></head>
<body><nav>导航不要</nav><article><h1>鲸歌笔记</h1>
<p>${"鲸歌是座头鲸的叫声，频率低，能传很远。".repeat(12)}</p></article>
<footer>页脚不要</footer></body></html>`;

test("无头浏览器读正文：<article> 正文、title、og:image", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(ARTICLE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/article`;

  // 默认阅读器会拦下内网地址（防被重定向进内网）。
  const guarded = createBrowserReader();
  const available = await guarded.available();
  if (!available) {
    await guarded.close();
    server.close();
    t.skip("本机没有可用的 Chromium，跳过真实读取。");
    return;
  }
  await assert.rejects(() => guarded.read(url), /内部网络/);
  await guarded.close();

  const reader = createBrowserReader({ allowPrivateHosts: true });
  try {
    const page = await reader.read(url);
    assert.equal(page.title, "鲸歌笔记");
    assert.equal(page.siteName, "深海小站");
    assert.match(page.text, /鲸歌是座头鲸的叫声/);
    assert.doesNotMatch(page.text, /导航不要|页脚不要/);
    assert.match(String(page.imageUrl), /og\.jpg$/);
  } finally {
    await reader.close();
    server.close();
  }
});
