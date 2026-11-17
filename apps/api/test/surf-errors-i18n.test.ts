import assert from "node:assert/strict";
import { lookup as dnsLookup } from "node:dns";
import { createServer } from "node:http";
import { test } from "node:test";
import { msg, resetLangForTest, runWithLang } from "../src/i18n/index.ts";
import { BrowserManager } from "../src/surf/browser.ts";
import { classifyError, ERROR_CODES, hasCode, SurfError, withCode } from "../src/surf/errors.ts";
import { createPageReader, fetchStaticHtml } from "../src/surf/page-reader.ts";
import { VideoError } from "../src/video/service.ts";
import { safeLookup, WebError } from "../src/webpage/service.ts";

// i18n-ignore-start：测试样例
/**
 * 普通错误（不是 SurfError、没有 code）的分类只看消息文字，必须和 0.3.6 完全一致。
 * 右边的期望值是用 0.3.6 的 classifyError 跑出来的；英文消息里带 login、returned 404 之类的词也不能改变结果。
 */
const MAIN_RESULTS: Array<[string, string]> = [
  ["Failed to parse login response JSON", "unknown"],
  ["Please sign in to continue", "unknown"],
  ["Server returned 404 Not Found", "unknown"],
  ["internal address blocked", "unknown"],
  ["Request took too long", "unknown"],
  ["Only http or https URLs", "unknown"],
  ["valid web address required", "unknown"],
  ["No main text found", "unknown"],
  ["Not enough text", "unknown"],
  ["account details hidden", "unknown"],
  ["didn't return a reply", "unknown"],
  ["won't be read", "unknown"],
  ["risk-control code -352", "unknown"],
  ["Unexpected token < in JSON", "unknown"],
  ["Too Many Requests", "rate_limit"],
  ["rate limit exceeded", "rate_limit"],
  ["net::ERR_NAME_NOT_RESOLVED", "network"],
  ["fetch failed", "network"],
  ["socket hang up", "network"],
  ["browserType.launch: Executable doesn't exist", "browser"],
  ["HTTP 503", "network"],
  ["HTTP 403", "content"],
  ["页面返回了 404。", "content"],
  ["这个地址指向内部网络，不会去读。", "content"],
  ["B 站触发 风控码 -352，本机已暂停视频请求至 x。", "rate_limit"],
  ["请求超时", "network"],
  ["需要登录", "content"],
];
// i18n-ignore-end

test("普通错误按文字分类，中英文模式下都和 0.3.6 一致", () => {
  for (const lang of ["zh", "en"] as const) {
    runWithLang(lang, () => {
      for (const [message, kind] of MAIN_RESULTS) assert.equal(classifyError(new Error(message)), kind, `${lang}: ${message}`);
    });
  }
  resetLangForTest("zh");
});

test("英文模式：带 code 的报错按 code 分类，外层包一层也认得", () => {
  runWithLang("en", () => {
    const en = msg();
    assert.equal(classifyError(withCode(new Error(en.core.bilibili.pausedUntil(en.core.bilibili.riskCode(-352), "later")), ERROR_CODES.rateLimited)), "rate_limit");
    assert.equal(classifyError(withCode(new VideoError(en.core.video.loginExpired), ERROR_CODES.content)), "content");
    assert.equal(classifyError(withCode(new Error(en.content.surf.search.internal), ERROR_CODES.content)), "content");
    assert.equal(classifyError(Object.assign(new Error(en.content.surf.search.status(404)), { status: 404 })), "content");
    assert.equal(classifyError(Object.assign(new Error(en.content.surf.search.status(503)), { status: 503 })), "network");
    const wrapped = new VideoError("Bilibili triggered risk-control code -352.", { cause: withCode(new Error("inner"), ERROR_CODES.rateLimited) });
    assert.equal(classifyError(wrapped), "rate_limit");
    // 没标 code 的同一句英文仍是 unknown：不靠英文文字猜
    assert.equal(classifyError(new Error(en.core.video.loginExpired)), "unknown");
  });
  resetLangForTest("zh");
});

test("英文模式：内部地址的报错带 code，静态抓取直接拒绝，不换浏览器重试", async () => {
  await runWithLang("en", async () => {
    const lookupError = await new Promise<unknown>((resolve) => (safeLookup as unknown as (h: string, o: object, cb: (e: unknown) => void) => void)("localhost", {}, resolve));
    assert.ok(lookupError instanceof WebError && hasCode(lookupError, ERROR_CODES.unsafeAddress));
    assert.equal(msg().core.webpage.internalAddress, (lookupError as Error).message);

    const server = createServer((_request, response) => response.end("<html><body>hi</body></html>"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      // 连接时由 safeLookup 拦下（英文报错）：转成带 code 的 SurfError
      await assert.rejects(() => fetchStaticHtml(`http://localhost:${port}/`, { lookup: safeLookup as typeof dnsLookup }), (error: unknown) =>
        error instanceof SurfError && hasCode(error, ERROR_CODES.unsafeAddress) && error.message === msg().content.surf.internalAddress);

      let rendered = 0;
      const browser = new BrowserManager({ chromiumModule: {} });
      browser.render = async () => { rendered += 1; throw new Error("should not render"); };
      const reader = createPageReader({ browser });
      await assert.rejects(() => reader.read(`http://127.0.0.1:${port}/`), (error: unknown) =>
        error instanceof SurfError && error.message === msg().content.surf.internalAddress);
      await assert.rejects(() => reader.read("ftp://example.com/"), (error: unknown) =>
        error instanceof SurfError && error.message === msg().content.surf.onlyHttp);
      assert.equal(rendered, 0);
      await reader.close();
    } finally {
      server.close();
    }
  });
  resetLangForTest("zh");
});
