import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BrowserManager,
  closeSharedBrowser,
  createChromiumInstaller,
  isBlockedRequest,
  sharedBrowser,
  type InstallStatus,
} from "../src/surf/browser.ts";
import { createPageReader } from "../src/surf/page-reader.ts";
import { stopSurf } from "../src/surf/index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FakeRequestLink {
  url(): string;
  redirectedFrom(): FakeRequestLink | null;
}

const HTML = `<html><head><title>渲染出来的</title></head><body><article>${"<p>这是脚本渲染出来的一整段正文，足够长，长到可以通过正文长度检查。</p>".repeat(10)}</article></body></html>`;

/** 假 playwright：记录启动、关闭、并发、被拦截的请求。 */
function fakeChromium(options: { gotoMs?: number; neverResolve?: boolean; html?: string; finalUrl?: string; redirects?: string[] } = {}) {
  const state = {
    launches: 0,
    browserCloses: 0,
    contextCloses: 0,
    activePages: 0,
    maxActive: 0,
    aborted: [] as string[],
    continued: [] as string[],
    contentReads: 0,
  };
  const requests = [
    { url: "https://example.com/", type: "document", nav: true },
    { url: "https://example.com/pic.png", type: "image", nav: false },
    { url: "https://example.com/font.woff", type: "font", nav: false },
    { url: "https://www.google-analytics.com/collect", type: "script", nav: false },
    { url: "https://example.com/app.js", type: "script", nav: false },
  ];
  const chromium = {
    async launch() {
      state.launches += 1;
      return {
        async newContext() {
          let handler: ((route: unknown) => Promise<void> | void) | null = null;
          return {
            async route(_pattern: string, fn: (route: unknown) => Promise<void> | void) {
              handler = fn;
            },
            async newPage() {
              return {
                async goto() {
                  state.activePages += 1;
                  state.maxActive = Math.max(state.maxActive, state.activePages);
                  try {
                    for (const request of requests) {
                      await handler?.({
                        request: () => ({ url: () => request.url, resourceType: () => request.type, isNavigationRequest: () => request.nav }),
                        abort: async () => void state.aborted.push(request.url),
                        continue: async () => void state.continued.push(request.url),
                      });
                    }
                    if (options.neverResolve) await new Promise(() => undefined);
                    if (options.gotoMs) await sleep(options.gotoMs);
                    const chain = [...(options.redirects ?? []), ...(options.finalUrl ? [options.finalUrl] : [])];
                    if (chain.length === 0) return undefined;
                    const link = (index: number): FakeRequestLink => ({
                      url: () => chain[index],
                      redirectedFrom: () => (index > 0 ? link(index - 1) : null),
                    });
                    return { request: () => link(chain.length - 1) };
                  } finally {
                    state.activePages -= 1;
                  }
                },
                async waitForTimeout() {},
                async content() {
                  state.contentReads += 1;
                  return options.html ?? HTML;
                },
                url: () => options.finalUrl ?? "https://example.com/",
                async close() {},
              };
            },
            async close() {
              state.contextCloses += 1;
            },
          };
        },
        async close() {
          state.browserCloses += 1;
        },
      };
    },
  };
  return { module: { chromium }, state };
}

test("请求拦截：图片/字体/媒体/广告追踪一律丢掉，文档和普通脚本放行", () => {
  assert.equal(isBlockedRequest("https://a.com/x.png", "image"), true);
  assert.equal(isBlockedRequest("https://a.com/x.woff2", "font"), true);
  assert.equal(isBlockedRequest("https://a.com/x.mp4", "media"), true);
  assert.equal(isBlockedRequest("wss://a.com/socket", "websocket"), true);
  assert.equal(isBlockedRequest("https://www.google-analytics.com/analytics.js", "script"), true);
  assert.equal(isBlockedRequest("https://hm.baidu.com/hm.js", "script"), true);
  assert.equal(isBlockedRequest("https://ads.example.com/a.js", "script"), true);
  assert.equal(isBlockedRequest("https://a.com/static/ads/banner.js", "script"), true);
  assert.equal(isBlockedRequest("https://a.com/app.js", "script"), false);
  assert.equal(isBlockedRequest("https://a.com/", "document"), false);
});

test("按需启动：没人用就不起 Chromium；用多次也只起一个（单例复用）", async () => {
  const fake = fakeChromium();
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true, idleMs: 5000 });
  assert.equal(fake.state.launches, 0, "创建管理器不会启动浏览器");
  assert.equal(manager.stats().running, false);
  await manager.render("https://example.com/a");
  await manager.render("https://example.com/b");
  await manager.render("https://example.com/c");
  assert.equal(fake.state.launches, 1, "三次渲染共用一个浏览器进程");
  assert.equal(fake.state.contextCloses, 3, "每页一个 context，用完即关");
  await manager.close();
  assert.equal(fake.state.browserCloses, 1);
});

test("渲染时丢掉图片/字体/追踪请求，只放行文档和普通脚本", async () => {
  const fake = fakeChromium();
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true });
  await manager.render("https://example.com/");
  assert.deepEqual(fake.state.aborted.sort(), ["https://example.com/font.woff", "https://example.com/pic.png", "https://www.google-analytics.com/collect"].sort());
  assert.deepEqual(fake.state.continued.sort(), ["https://example.com/", "https://example.com/app.js"].sort());
  await manager.close();
});

test("渲染：302 跳转链上有内网地址时，读正文前就拒绝", async () => {
  // 用公网 IP 字面量做起点，第一跳校验不依赖 DNS。
  const fake = fakeChromium({ redirects: ["https://93.184.216.34/"], finalUrl: "http://192.168.1.1/" });
  const manager = new BrowserManager({ chromiumModule: fake.module });
  await assert.rejects(() => manager.render("https://93.184.216.34/"), /内部网络/);
  assert.equal(fake.state.contentReads, 0, "内网页面不能读正文");
  await manager.close();
});

test("空闲自动关闭：用完 idleMs 之后浏览器自己关；再用会重新启动", async () => {
  const fake = fakeChromium();
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true, idleMs: 40 });
  await manager.render("https://example.com/a");
  assert.equal(manager.stats().running, true);
  await sleep(120);
  assert.equal(fake.state.browserCloses, 1, "空闲到点自动关闭");
  assert.equal(manager.stats().running, false);
  await manager.render("https://example.com/b");
  assert.equal(fake.state.launches, 2, "关掉之后再用，重新启动");
  await manager.close();
});

test("空闲计时：页面还在跑的时候不会被关掉", async () => {
  const fake = fakeChromium({ gotoMs: 120 });
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true, idleMs: 30 });
  await manager.render("https://example.com/slow");
  assert.equal(fake.state.browserCloses, 0, "渲染期间不算空闲");
  await manager.close();
});

test("并发上限 2：同时来 5 个只有 2 个在跑", async () => {
  const fake = fakeChromium({ gotoMs: 40 });
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true });
  await Promise.all(Array.from({ length: 5 }, (_, i) => manager.render(`https://example.com/${i}`)));
  assert.equal(fake.state.maxActive, 2);
  assert.equal(fake.state.contextCloses, 5);
  await manager.close();
});

test("每页超时：页面卡住就放弃，并关掉对应的 context", async () => {
  const fake = fakeChromium({ neverResolve: true });
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true, pageTimeoutMs: 80 });
  const started = Date.now();
  await assert.rejects(() => manager.render("https://example.com/hang"), /秒还没打开/);
  assert.ok(Date.now() - started < 1500, "不能一直挂着");
  assert.equal(fake.state.contextCloses, 1);
  assert.equal(manager.stats().activePages, 0, "名额要还回来");
  await manager.close();
});

test("会话取消（总时长到了）会立刻放弃正在等的页面", async () => {
  const fake = fakeChromium({ neverResolve: true });
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true, pageTimeoutMs: 10_000 });
  const controller = new AbortController();
  const pending = manager.render("https://example.com/hang", { signal: controller.signal });
  setTimeout(() => controller.abort(new Error("会话超时")), 30);
  await assert.rejects(() => pending, /会话超时/);
  assert.equal(fake.state.contextCloses, 1);
  await manager.close();
});

test("close({permanent}) 之后不再启动浏览器", async () => {
  const fake = fakeChromium();
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true });
  await manager.render("https://example.com/a");
  await manager.close({ permanent: true });
  assert.equal(fake.state.browserCloses, 1);
  await assert.rejects(() => manager.render("https://example.com/b"), /已经停止/);
  assert.equal(fake.state.launches, 1);
});

test("stopSurf()：关掉共享的 Chromium，重复调用安全", async () => {
  const fake = fakeChromium();
  const manager = sharedBrowser({ chromiumModule: fake.module, allowPrivateHosts: true });
  await manager.render("https://example.com/a");
  assert.equal(manager.stats().running, true);
  await stopSurf();
  assert.equal(fake.state.browserCloses, 1);
  await stopSurf();
  await closeSharedBrowser();
  assert.equal(fake.state.browserCloses, 1);
});

test("静态页面不需要浏览器；脚本渲染的页面才会启动浏览器", async () => {
  const fake = fakeChromium();
  const manager = new BrowserManager({ chromiumModule: fake.module, allowPrivateHosts: true });
  const staticHtml = HTML;
  const jsShell = "<html><head><title>壳</title></head><body><div id=app></div><script src=app.js></script></body></html>";
  const reader = createPageReader({
    browser: manager,
    allowPrivateHosts: true,
    fetchStatic: async (url) => ({ html: url.includes("shell") ? jsShell : staticHtml, url }),
  });
  const page = await reader.read("https://example.com/static");
  assert.match(page.text, /脚本渲染出来的一整段正文/);
  assert.equal(fake.state.launches, 0, "静态页面读完了，没有起浏览器");
  await reader.read("https://example.com/shell");
  assert.equal(fake.state.launches, 1, "只有静态读不出来才起浏览器");
  await reader.close();
});

// ---- 无 Chromium 时的降级 ----

test("没有 Chromium：后台自动安装一次，状态里能看到进度；装完即用", async () => {
  let installed = false;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let runs = 0;
  const installer = createChromiumInstaller({
    installed: () => installed,
    run: async (onProgress) => {
      runs += 1;
      onProgress(10, "正在下载浏览器");
      await gate;
      onProgress(100, "正在下载浏览器");
      installed = true;
    },
  });
  const manager = new BrowserManager({ installer });
  assert.equal(manager.isReady(), false);
  assert.equal(manager.installStatus().state, "idle");
  manager.prepare();
  manager.prepare();
  assert.equal(runs, 1, "只触发一次安装");
  let status: InstallStatus = manager.installStatus();
  assert.equal(status.state, "installing");
  assert.equal(status.percent, 10);
  release();
  await sleep(10);
  status = manager.installStatus();
  assert.equal(status.state, "ready");
  assert.equal(manager.isReady(), true);
});

test("没有 Chromium：渲染请求抛出可识别的 browser 错误，不卡住也不崩", async () => {
  const installer = createChromiumInstaller({ installed: () => false, run: async () => { throw new Error("下载失败"); } });
  const manager = new BrowserManager({ installer, allowPrivateHosts: true });
  await assert.rejects(() => manager.render("https://example.com/"), (error: Error & { kind?: string }) => error.kind === "browser");
  await sleep(10);
  assert.equal(manager.installStatus().state, "failed");
  assert.match(manager.installStatus().message, /下载失败/);
});

test("没有 Chromium：静态能读的页面照常读，脚本页如实跳过并开始安装", async () => {
  let started = 0;
  const installer = createChromiumInstaller({ installed: () => false, run: async () => void (started += 1) });
  const manager = new BrowserManager({ installer, allowPrivateHosts: true });
  const jsShell = "<html><body><div id=app></div></body></html>";
  const reader = createPageReader({
    browser: manager,
    fetchStatic: async (url) => ({ html: url.includes("shell") ? jsShell : HTML, url }),
  });
  assert.equal(await reader.available(), true, "静态抓取始终可用");
  const ok = await reader.read("https://example.com/static");
  assert.ok(ok.text.length > 200);
  await assert.rejects(() => reader.read("https://example.com/shell"), /浏览器还没准备好/);
  assert.equal(started, 1);
});
