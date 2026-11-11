import assert from "node:assert/strict";
import { lookup as dnsLookup } from "node:dns";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BrowserManager, resolvesPublic } from "../src/surf/browser.ts";
import { createPageReader, fetchStaticHtml } from "../src/surf/page-reader.ts";
import { filterWebResults } from "../src/surf/picker.ts";
import { thumbFetcher } from "../src/surf/thumbs.ts";
import { decodeBingRedirect, decodeDuckDuckGoRedirect, parseBingResults, parseDuckDuckGoResults, createWebSource } from "../src/surf/web-search.ts";

/** 测试用 lookup：public.test 指向本机夹具，其他域名一律当作内网；和 safeLookup 一样在连接时判定。 */
const testLookup = ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
  const done = typeof options === "function" ? (options as typeof callback) : callback;
  const address = hostname === "public.test" ? "127.0.0.1" : undefined;
  if (!address) return done(new Error("这个链接指向内部地址，不会去读。"));
  const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
  return wantsAll ? done(null, [{ address, family: 4 }]) : done(null, address, 4);
}) as typeof dnsLookup;

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
    reader: { available: async () => true, read: async () => { throw new Error("不该读"); }, prepare() {}, browserStatus: () => ({ state: "ready", percent: 100, message: "" }), close: async () => {} },
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

test("读正文：静态抓取 + Readability，去掉导航页脚，拿到 og:image；默认拒绝内网地址", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(ARTICLE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/article`;

  // 默认阅读器会拦下内网地址（防被重定向进内网）。
  const guarded = createPageReader({ browser: new BrowserManager({ chromiumModule: {} }) });
  await assert.rejects(() => guarded.read(url), /内部网络/);
  await guarded.close();

  const reader = createPageReader({ allowPrivateHosts: true, browser: new BrowserManager({ chromiumModule: {}, allowPrivateHosts: true }) });
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

test("静态抓取：每一跳都在连接时校验，公网页面跳到内网会被拒绝", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/page") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(ARTICLE);
      return;
    }
    if (request.url === "/jump") {
      response.writeHead(302, { location: "http://internal.test/secret" });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const page = await fetchStaticHtml(`http://public.test:${port}/page`, { lookup: testLookup });
    assert.match(page.html, /鲸歌笔记/);
    // 302 跳到内网：第二跳在连接时被 lookup 拦下，不会发出请求。
    await assert.rejects(() => fetchStaticHtml(`http://public.test:${port}/jump`, { lookup: testLookup }), /内部网络/);
    // 域名直接解析到内网也一样。
    await assert.rejects(() => fetchStaticHtml(`http://internal.test:${port}/page`, { lookup: testLookup }), /内部网络/);
  } finally {
    server.close();
  }
});

test("缩略图：跳转目标逐跳校验，超过 2 MB 立刻停止读取", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wp-thumbs-"));
  const chunk = Buffer.alloc(64 * 1024, 7);
  const total = 8 * 1024 * 1024;
  let writtenAtClose = -1;
  let markClosed!: () => void;
  const closed = new Promise<void>((resolve) => { markClosed = resolve; });
  const server = createServer((request, response) => {
    if (request.url === "/ok.jpg") {
      response.writeHead(200, { "content-type": "image/jpeg" });
      response.end(Buffer.alloc(2048, 1));
      return;
    }
    if (request.url === "/jump.jpg") {
      response.writeHead(302, { location: "http://internal.test/x.jpg" });
      response.end();
      return;
    }
    if (request.url === "/big.jpg") {
      response.writeHead(200, { "content-type": "image/jpeg" });
      let written = 0;
      const timer = setInterval(() => {
        if (written >= total) {
          clearInterval(timer);
          response.end();
          return;
        }
        response.write(chunk);
        written += chunk.length;
      }, 1);
      response.on("close", () => {
        clearInterval(timer);
        writtenAtClose = written;
        markClosed();
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const fetcher = thumbFetcher(dir, { lookup: testLookup });
  try {
    assert.equal(await fetcher.fetch(`http://public.test:${port}/ok.jpg`, 1), "thumbs/1.jpg");
    // og:image 指向的地址跳到内网：不跟随。
    assert.equal(await fetcher.fetch(`http://public.test:${port}/jump.jpg`, 2), null);
    // 超过 2 MB 的「图片」不整包读进内存。
    assert.equal(await fetcher.fetch(`http://public.test:${port}/big.jpg`, 3), null);
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
    assert.ok(writtenAtClose >= 0, "超过上限后客户端要主动断开");
    assert.ok(writtenAtClose < total, `超过 2 MB 后不应继续读完（只写到 ${writtenAtClose} 字节）`);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
