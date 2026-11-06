import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isPrivateAddress } from "../web-service.ts";
import type { WebPageText } from "./types.ts";

/**
 * 网页阅读器（§10.6.8 B.3–B.4）：playwright-core 起一个无头 Chromium，每个会话一个 context。
 * 图片/媒体/字体/websocket 一律 abort；每次导航前再查一次解析地址，防止被重定向进内网。
 * 没装 Chromium 时不抛异常，`available()` 返回 false，网页部分整体跳过（状态里写 webAvailable:false）。
 */

export interface PageReader {
  available(): Promise<boolean>;
  read(url: string): Promise<WebPageText>;
  close(): Promise<void>;
}

export interface BrowserReaderOptions {
  /** SURF_CHROMIUM_PATH 覆盖自带的浏览器。 */
  chromiumPath?: string;
  /** 空闲多久关掉浏览器（默认 5 分钟）。 */
  idleMs?: number;
  /** 只给测试用：允许读本机/内网地址（本地夹具服务器）。 */
  allowPrivateHosts?: boolean;
  /** 只给测试用：注入一个假的 chromium 模块。 */
  chromiumModule?: unknown;
}

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

const inContainer = () => existsSync("/.dockerenv") || existsSync("/run/.containerenv");

type AnyChromium = {
  launch(options?: Record<string, unknown>): Promise<AnyBrowser>;
};

type AnyBrowser = {
  newContext(options?: Record<string, unknown>): Promise<AnyContext>;
  close(): Promise<void>;
};

type AnyContext = {
  route(pattern: string, handler: (route: AnyRoute) => Promise<void> | void): Promise<void>;
  newPage(): Promise<AnyPage>;
  close(): Promise<void>;
};

type AnyRoute = {
  request(): { url(): string; resourceType(): string; isNavigationRequest(): boolean };
  abort(): Promise<void>;
  continue(): Promise<void>;
};

type AnyPage = {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  close(): Promise<void>;
};

const EXTRACT = () => {
  const drop = "nav,header,footer,aside,script,style,noscript,form,iframe,svg";
  const textOf = (node: Element) => {
    const clone = node.cloneNode(true) as Element;
    clone.querySelectorAll(drop).forEach((child) => child.remove());
    return (clone as HTMLElement).innerText ?? clone.textContent ?? "";
  };
  const direct = document.querySelector("article, main, [role=main]");
  let target: Element | null = direct;
  if (!target) {
    let best = 0;
    document.querySelectorAll("div, section").forEach((node) => {
      const text = (node as HTMLElement).innerText ?? "";
      if (text.length < 200) return;
      const linkText = Array.from(node.querySelectorAll("a")).reduce((sum, a) => sum + ((a as HTMLElement).innerText?.length ?? 0), 0);
      const score = text.length * (1 - Math.min(0.9, linkText / Math.max(1, text.length)));
      if (score > best) {
        best = score;
        target = node;
      }
    });
  }
  const text = target ? textOf(target) : (document.body?.innerText ?? "");
  const ogImage = document.querySelector('meta[property="og:image"], meta[name="og:image"]')?.getAttribute("content") ?? "";
  const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ?? "";
  const fallbackImage = Array.from(document.querySelectorAll("img"))
    .map((img) => ({ src: img.currentSrc || img.src, width: img.naturalWidth || img.width }))
    .find((item) => item.src && item.width >= 300)?.src ?? "";
  return { text, ogImage, siteName, fallbackImage, title: document.title };
};

export function createBrowserReader(options: BrowserReaderOptions = {}): PageReader {
  const idleMs = options.idleMs ?? 5 * 60_000;
  let browser: AnyBrowser | null = null;
  let launching: Promise<AnyBrowser> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let unavailable = false;

  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void close();
    }, idleMs);
    idleTimer.unref?.();
  };

  const close = async () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const current = browser;
    browser = null;
    launching = null;
    if (current) await current.close().catch(() => undefined);
  };

  const ensure = async (): Promise<AnyBrowser> => {
    if (browser) return browser;
    if (launching) return launching;
    launching = (async () => {
      const module = (options.chromiumModule ?? (await import("playwright-core"))) as { chromium: AnyChromium };
      const launchOptions: Record<string, unknown> = { headless: true };
      if (options.chromiumPath) launchOptions.executablePath = options.chromiumPath;
      // 容器里必须关 sandbox；普通桌面不加这个参数。
      if (inContainer()) launchOptions.args = ["--no-sandbox"];
      const instance = await module.chromium.launch(launchOptions);
      browser = instance;
      return instance;
    })().catch((error: unknown) => {
      unavailable = true;
      launching = null;
      throw error;
    });
    const instance = await launching;
    touch();
    return instance;
  };

  const guard = async (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("这不是有效的网页地址。");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("只能读 http 或 https 网页。");
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (options.allowPrivateHosts) return parsed;
    if (!(await resolvesPublic(host))) throw new Error("这个地址指向内部网络，不会去读。");
    return parsed;
  };

  const closeContext = async (context: AnyContext | null) => {
    if (context) await context.close().catch(() => undefined);
    touch();
  };

  return {
    // 只看「有没有可用的浏览器」，不为了报个状态就真的起一个进程（状态接口每页都会调）。
    async available() {
      if (unavailable) return false;
      if (browser) return true;
      try {
        const module = (options.chromiumModule ?? (await import("playwright-core"))) as {
          chromium: AnyChromium & { executablePath?: () => string };
        };
        const path = options.chromiumPath ?? module.chromium.executablePath?.();
        if (!path) return true; // 假模块：交给真正的 launch 去判定
        return existsSync(path);
      } catch {
        return false;
      }
    },

    async read(url) {
      const target = await guard(url);
      const instance = await ensure();
      const context = await instance.newContext({
        locale: "zh-CN",
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        javaScriptEnabled: true,
      });
      try {
        await context.route("**/*", async (route) => {
          const request = route.request();
          const type = request.resourceType();
          if (type === "image" || type === "media" || type === "font" || type === "websocket") {
            await route.abort();
            return;
          }
          if (request.isNavigationRequest()) {
            try {
              await guard(request.url());
            } catch {
              await route.abort();
              return;
            }
          }
          await route.continue();
        });

        const page = await context.newPage();
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForTimeout(1500);
        const raw = await page.evaluate(EXTRACT);
        const text = String(raw.text ?? "")
          .replace(/[ \t\f\v]+/g, " ")
          .replace(/\s*\n\s*/g, "\n")
          .replace(/\n{2,}/g, "\n")
          .trim()
          .slice(0, 8000);
        if (text.length < 200) throw new Error("网页里没有读到足够的文字。");
        const site = String(raw.siteName ?? "").trim() || target.hostname.replace(/^www\./, "");
        return {
          url: target.toString(),
          title: String(raw.title ?? "").trim() || site,
          text,
          siteName: site,
          imageUrl: String(raw.ogImage || raw.fallbackImage || "") || undefined,
        };
      } finally {
        await closeContext(context);
      }
    },

    close,
  };
}
