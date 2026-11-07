import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { browsersDir } from "../data-dir.ts";
import { isPrivateAddress } from "../web-service.ts";
import { classifyError, SurfError } from "./errors.ts";

/**
 * 无头浏览器的生命周期（单例、按需、会自己收摊）：
 * - 第一次真的需要渲染页面时才启动 Chromium，之后所有会话复用同一个进程；
 * - 空闲 60 秒自动关闭，下次再用再起；`close()` 随时可以把它关干净（后端退出时用）；
 * - 同时最多 2 个页面在跑，每个页面 15 秒超时，会话取消时立即关掉对应的 context；
 * - 图片、媒体、字体、websocket 和广告/追踪请求一律不加载，只留 HTML 和脚本；
 * - 每次导航（含重定向）都重新校验是不是公网地址；
 * - 没装 Chromium 时在数据目录下自动安装（用 playwright-core 自带的 CLI），进度可查询。
 */

export const IDLE_CLOSE_MS = 60_000;
export const PAGE_TIMEOUT_MS = 15_000;
export const MAX_CONCURRENT_PAGES = 2;

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 域名解析结果里只要有一个内网地址就拒绝（DNS 重绑定也过不去）。 */
export async function resolvesPublic(host: string): Promise<boolean> {
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

// ---- 请求拦截 ----

const BLOCKED_TYPES = new Set(["image", "media", "font", "websocket", "eventsource", "ping", "manifest", "texttrack"]);

const TRACKER_HOSTS = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com", "googletagmanager.com",
  "googletagservices.com", "adservice.google.com", "facebook.net", "connect.facebook.com", "scorecardresearch.com",
  "taboola.com", "outbrain.com", "criteo.com", "adnxs.com", "hotjar.com", "mixpanel.com", "segment.io", "sentry.io",
  "hm.baidu.com", "cnzz.com", "umeng.com", "51.la", "mmstat.com", "gdt.qq.com", "pos.baidu.com", "cpro.baidu.com",
  "bdstatic.com/linksubmit", "ads.", "adservice.", "analytics.", "track.", "tracker.", "stat.", "pixel.",
];

const TRACKER_PATH = /(\/ads?\/|\/adsbygoogle|\/analytics|\/track(ing)?\b|\/pixel\b|\/beacon\b|\/collect\?|\/gtag\/|\/gtm\.js|\/ga\.js)/i;

/** 这条请求要不要直接丢掉（纯函数，测试直接断言）。 */
export function isBlockedRequest(url: string, resourceType: string): boolean {
  if (BLOCKED_TYPES.has(resourceType)) return true;
  if (resourceType === "document") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  for (const entry of TRACKER_HOSTS) {
    if (entry.endsWith(".") ? host.startsWith(entry) : host === entry || host.endsWith(`.${entry}`) || `${host}${parsed.pathname}`.startsWith(entry)) return true;
  }
  return TRACKER_PATH.test(parsed.pathname);
}

// ---- 浏览器接口（只写用到的那部分，方便测试里换成假的） ----

export type AnyChromium = {
  launch(options?: Record<string, unknown>): Promise<AnyBrowser>;
  executablePath?: () => string;
};

export type AnyBrowser = {
  newContext(options?: Record<string, unknown>): Promise<AnyContext>;
  close(): Promise<void>;
  on?(event: "disconnected", listener: () => void): void;
};

export type AnyContext = {
  route(pattern: string, handler: (route: AnyRoute) => Promise<void> | void): Promise<void>;
  newPage(): Promise<AnyPage>;
  close(): Promise<void>;
};

export type AnyRoute = {
  request(): { url(): string; resourceType(): string; isNavigationRequest(): boolean };
  abort(): Promise<void>;
  continue(): Promise<void>;
};

export type AnyPage = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
};

// ---- Chromium 安装 ----

export interface InstallStatus {
  state: "idle" | "installing" | "ready" | "failed";
  /** 0–100；拿不到进度时是 null。 */
  percent: number | null;
  message: string;
}

export interface ChromiumInstaller {
  status(): InstallStatus;
  isInstalled(): boolean;
  /** 开始安装；已经在装就返回同一个 Promise。 */
  start(): Promise<void>;
}

/** 浏览器装在哪：用户自己设了 PLAYWRIGHT_BROWSERS_PATH 就尊重，否则放进数据目录。 */
export const effectiveBrowsersPath = (env: Record<string, string | undefined> = process.env) =>
  env.PLAYWRIGHT_BROWSERS_PATH?.trim() || browsersDir(env);

function playwrightRoot(): string | null {
  try {
    return dirname(createRequire(import.meta.url).resolve("playwright-core/package.json"));
  } catch {
    return null;
  }
}

/** 这版 playwright 要的 chromium 修订号（装过别的版本不算数）。 */
function expectedRevisions(): string[] {
  const root = playwrightRoot();
  if (!root) return [];
  try {
    const parsed = JSON.parse(readFileSync(join(root, "browsers.json"), "utf8")) as { browsers?: Array<{ name: string; revision: string }> };
    return (parsed.browsers ?? [])
      .filter((entry) => entry.name === "chromium" || entry.name === "chromium-headless-shell")
      .map((entry) => (entry.name === "chromium" ? `chromium-${entry.revision}` : `chromium_headless_shell-${entry.revision}`));
  } catch {
    return [];
  }
}

export function chromiumInstalledAt(browsersPath: string): boolean {
  const wanted = expectedRevisions();
  if (wanted.length === 0) return false;
  return wanted.some((name) => existsSync(join(browsersPath, name, "INSTALLATION_COMPLETE")));
}

export interface InstallerOptions {
  browsersPath?: string;
  /** 测试注入：不真的下载。 */
  run?: (onProgress: (percent: number | null, message: string) => void) => Promise<void>;
  installed?: () => boolean;
}

export function createChromiumInstaller(options: InstallerOptions = {}): ChromiumInstaller {
  const path = () => options.browsersPath ?? effectiveBrowsersPath();
  let status: InstallStatus = { state: "idle", percent: null, message: "" };
  let running: Promise<void> | null = null;
  const installed = () => (options.installed ? options.installed() : chromiumInstalledAt(path()));

  const runCli = (onProgress: (percent: number | null, message: string) => void) =>
    new Promise<void>((resolve, reject) => {
      const root = playwrightRoot();
      if (!root) return reject(new SurfError("browser", "找不到 playwright-core，装不了浏览器。"));
      const child = spawn(process.execPath, [join(root, "cli.js"), "install", "--only-shell", "chromium"], {
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path() },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let tail = "";
      const feed = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        tail = (tail + text).slice(-400);
        const matches = [...text.matchAll(/(\d{1,3})%/g)];
        const last = matches.at(-1);
        if (last) onProgress(Math.min(100, Number(last[1])), "正在下载浏览器");
      };
      child.stdout.on("data", feed);
      child.stderr.on("data", feed);
      child.on("error", (error) => reject(new SurfError("browser", `浏览器安装没能启动：${error.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new SurfError("browser", `浏览器安装失败（${code}）：${tail.replace(/\s+/g, " ").trim().slice(-120)}`));
      });
    });

  return {
    status() {
      if (status.state === "idle" && installed()) return { state: "ready", percent: 100, message: "浏览器已就绪" };
      return status;
    },
    isInstalled: installed,
    start() {
      if (running) return running;
      if (installed()) {
        status = { state: "ready", percent: 100, message: "浏览器已就绪" };
        return Promise.resolve();
      }
      status = { state: "installing", percent: null, message: "正在准备浏览器，第一次需要下载一次" };
      const runner = options.run ?? runCli;
      running = runner((percent, message) => {
        status = { state: "installing", percent, message };
      })
        .then(() => {
          status = { state: "ready", percent: 100, message: "浏览器已就绪" };
        })
        .catch((error: unknown) => {
          status = { state: "failed", percent: null, message: error instanceof Error ? error.message : String(error) };
        })
        .finally(() => {
          running = null;
        });
      return running;
    },
  };
}

// ---- 并发闸 ----

export class Semaphore {
  readonly #max: number;
  #active = 0;
  readonly #waiters: Array<() => void> = [];
  constructor(max: number) {
    this.#max = max;
  }
  get active() {
    return this.#active;
  }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw signal.reason ?? new SurfError("aborted", "已中止");
    if (this.#active >= this.#max) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = this.#waiters.indexOf(wake);
          if (index !== -1) this.#waiters.splice(index, 1);
          reject(signal?.reason ?? new SurfError("aborted", "已中止"));
        };
        this.#waiters.push(wake);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      this.#waiters.shift()?.();
    };
  }
}

// ---- 浏览器管理器 ----

export interface BrowserManagerOptions {
  /** SURF_CHROMIUM_PATH 覆盖自带的浏览器。 */
  chromiumPath?: string;
  idleMs?: number;
  pageTimeoutMs?: number;
  maxConcurrent?: number;
  /** 没装时是否自动安装（默认是）。 */
  autoInstall?: boolean;
  installer?: ChromiumInstaller;
  /** 只给测试用：允许读本机/内网地址（本地夹具服务器）。 */
  allowPrivateHosts?: boolean;
  /** 只给测试用：注入一个假的 chromium 模块。 */
  chromiumModule?: unknown;
}

export interface BrowserStats {
  running: boolean;
  launches: number;
  activePages: number;
}

export interface RenderedPage {
  html: string;
  url: string;
}

const inContainer = () => existsSync("/.dockerenv") || existsSync("/run/.containerenv");

export class BrowserManager {
  readonly installer: ChromiumInstaller;
  readonly #options: BrowserManagerOptions;
  readonly #gate: Semaphore;
  #browser: AnyBrowser | null = null;
  #launching: Promise<AnyBrowser> | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #launches = 0;
  #closed = false;
  #installRequested = false;

  constructor(options: BrowserManagerOptions = {}) {
    this.#options = options;
    this.#gate = new Semaphore(options.maxConcurrent ?? MAX_CONCURRENT_PAGES);
    this.installer = options.installer ?? createChromiumInstaller();
    // playwright 在 import 时读这个变量，所以必须先设。
    if (!options.chromiumModule && !process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = effectiveBrowsersPath();
  }

  stats(): BrowserStats {
    return { running: Boolean(this.#browser), launches: this.#launches, activePages: this.#gate.active };
  }

  /** 浏览器能不能用：假模块、指定了路径、或已经装好。不会真的启动进程。 */
  isReady(): boolean {
    if (this.#options.chromiumModule) return true;
    if (this.#options.chromiumPath) return existsSync(this.#options.chromiumPath);
    return this.installer.isInstalled();
  }

  /** 想用浏览器但还没装：后台开始装（只触发一次），调用方先走降级路径。 */
  prepare(): void {
    if (this.#closed || this.isReady() || this.#options.autoInstall === false || this.#options.chromiumPath) return;
    if (this.#installRequested && this.installer.status().state !== "failed") return;
    this.#installRequested = true;
    void this.installer.start();
  }

  installStatus(): InstallStatus {
    if (this.isReady()) return { state: "ready", percent: 100, message: "浏览器已就绪" };
    return this.installer.status();
  }

  #touch() {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    if (!this.#browser || this.#gate.active > 0) return;
    this.#idleTimer = setTimeout(() => {
      void this.#closeBrowser();
    }, this.#options.idleMs ?? IDLE_CLOSE_MS);
    this.#idleTimer.unref?.();
  }

  async #closeBrowser() {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    const current = this.#browser;
    this.#browser = null;
    this.#launching = null;
    if (current) await current.close().catch(() => undefined);
  }

  async #launch(): Promise<AnyBrowser> {
    if (this.#closed) throw new SurfError("aborted", "冲浪已经停止，不再启动浏览器。");
    if (this.#browser) return this.#browser;
    if (this.#launching) return this.#launching;
    this.#launching = (async () => {
      const module = (this.#options.chromiumModule ?? (await import("playwright-core"))) as { chromium: AnyChromium };
      const base: Record<string, unknown> = { headless: true };
      if (this.#options.chromiumPath) base.executablePath = this.#options.chromiumPath;
      // 容器里必须关 sandbox；普通桌面不加这个参数。
      if (inContainer()) base.args = ["--no-sandbox"];
      let instance: AnyBrowser;
      try {
        instance = await module.chromium.launch(base);
      } catch (first) {
        // 只装了完整版 chromium 时 headless shell 不存在，换成新 headless 再试一次。
        if (!/executable doesn't exist/i.test(String((first as Error)?.message))) throw new SurfError("browser", `浏览器起不来：${(first as Error)?.message ?? first}`, { cause: first });
        try {
          instance = await module.chromium.launch({ ...base, channel: "chromium" });
        } catch (second) {
          throw new SurfError("browser", `浏览器起不来：${(second as Error)?.message ?? second}`, { cause: second });
        }
      }
      if (this.#closed) {
        await instance.close().catch(() => undefined);
        throw new SurfError("aborted", "冲浪已经停止，不再启动浏览器。");
      }
      this.#launches += 1;
      this.#browser = instance;
      instance.on?.("disconnected", () => {
        if (this.#browser === instance) {
          this.#browser = null;
          this.#launching = null;
        }
      });
      return instance;
    })().catch((error: unknown) => {
      this.#launching = null;
      throw error;
    });
    return this.#launching;
  }

  async #guard(url: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new SurfError("content", "这不是有效的网页地址。");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new SurfError("content", "只能读 http 或 https 网页。");
    if (this.#options.allowPrivateHosts) return parsed;
    if (!(await resolvesPublic(parsed.hostname.replace(/^\[|\]$/g, "")))) throw new SurfError("content", "这个地址指向内部网络，不会去读。");
    return parsed;
  }

  /** 用浏览器渲染一个页面并取回 HTML。最多 2 个并行；15 秒超时；取消时立刻关掉。 */
  async render(url: string, options: { signal?: AbortSignal } = {}): Promise<RenderedPage> {
    if (this.#closed) throw new SurfError("aborted", "冲浪已经停止。");
    const target = await this.#guard(url);
    if (!this.isReady()) {
      this.prepare();
      throw new SurfError("browser", "这台机器上的浏览器还没准备好。");
    }
    const release = await this.#gate.acquire(options.signal);
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
    let context: AnyContext | null = null;
    const timeoutMs = this.#options.pageTimeoutMs ?? PAGE_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const browser = await this.#launch();
      const opened = await browser.newContext({
        locale: "zh-CN",
        viewport: { width: 1280, height: 800 },
        userAgent: DESKTOP_UA,
        javaScriptEnabled: true,
        serviceWorkers: "block",
      });
      context = opened;
      await opened.route("**/*", async (route) => {
        const request = route.request();
        if (isBlockedRequest(request.url(), request.resourceType())) {
          await route.abort().catch(() => undefined);
          return;
        }
        if (request.isNavigationRequest()) {
          try {
            await this.#guard(request.url());
          } catch {
            await route.abort().catch(() => undefined);
            return;
          }
        }
        await route.continue().catch(() => undefined);
      });
      const page = await opened.newPage();
      const work = (async () => {
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
        // 给脚本渲染正文留一小会儿，但不长等。
        await page.waitForTimeout(600);
        return { html: await page.content(), url: page.url() };
      })();
      const guardRace = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SurfError("network", `页面 ${Math.round(timeoutMs / 1000)} 秒还没打开，放弃。`)), timeoutMs + 500);
        onAbort = () => reject(options.signal?.reason ?? new SurfError("aborted", "已中止"));
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener("abort", onAbort, { once: true });
      });
      work.catch(() => undefined);
      return await Promise.race([work, guardRace]);
    } catch (error) {
      if (error instanceof SurfError) throw error;
      const kind = classifyError(error, options.signal);
      throw new SurfError(kind === "unknown" ? "content" : kind, error instanceof Error ? error.message : String(error), { cause: error });
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
      if (context) await context.close().catch(() => undefined);
      release();
      this.#touch();
    }
  }

  /** 立刻关闭浏览器；`permanent` 之后再也不会启动（后端退出用）。 */
  async close(options: { permanent?: boolean } = {}) {
    if (options.permanent) this.#closed = true;
    await this.#closeBrowser();
  }
}

// ---- 全局单例（所有会话、所有角色共用一个 Chromium） ----

let shared: BrowserManager | null = null;

export function sharedBrowser(options: BrowserManagerOptions = {}): BrowserManager {
  shared ??= new BrowserManager(options);
  return shared;
}

/** 关掉共享的浏览器（stopSurf 用）。没有启动过就什么也不做。 */
export async function closeSharedBrowser() {
  const current = shared;
  shared = null;
  if (current) await current.close({ permanent: true });
}
