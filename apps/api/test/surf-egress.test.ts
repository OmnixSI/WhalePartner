import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { existsSync, readdirSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { connect, createServer as createTcpServer, isIP, type AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { BrowserManager, effectiveBrowsersPath } from "../src/surf/browser.ts";
import { startEgressProxy } from "../src/surf/egress-proxy.ts";

const PUBLIC_ADDRESS = "203.0.113.10"; // TEST-NET-3：按规则属于“公网”，实际不可达，靠 dial 改道到本机夹具
const SECRET = "INTERNAL-SECRET-BODY";

/** 本机夹具服务器：记下收到的每个请求。 */
async function fixture(handler: (request: IncomingMessage, respond: (status: number, body: string, headers?: Record<string, string>) => void) => void) {
  const hits: string[] = [];
  const server: Server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    handler(request, (status, body, headers = {}) => {
      response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return { hits, port: (server.address() as AddressInfo).port, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }) };
}

const toFixture = (port: number) => (address: string, target: number) =>
  address === PUBLIC_ADDRESS ? { host: "127.0.0.1", port: target === 80 ? port : target } : { host: address, port: target };

/** 经代理发一个 HTTP 请求（绝对地址形式）。 */
function viaProxy(proxyUrl: string, target: string): Promise<{ status: number; body: string }> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: proxy.hostname, port: Number(proxy.port), method: "GET", path: target, headers: { host: new URL(target).host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.end();
  });
}

/** 经代理发 CONNECT，返回代理回的状态行。 */
function connectVia(proxyUrl: string, authority: string): Promise<string> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(proxy.port), proxy.hostname, () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.once("data", (chunk) => { socket.destroy(); resolve(chunk.toString("latin1").split("\r\n")[0]); });
    socket.once("error", reject);
  });
}

test("出口代理：回环 / 内网地址字面量和解析到内网的域名在连接前被拒，内网服务收到 0 个请求", async () => {
  const internal = await fixture((_request, respond) => respond(200, SECRET));
  const proxy = await startEgressProxy({ lookup: async (host) => (host === "rebind.test" ? ["127.0.0.1"] : [PUBLIC_ADDRESS]) });
  try {
    for (const host of ["127.0.0.1", "localhost", "[::1]", "10.0.0.5", "169.254.169.254", "rebind.test"]) {
      const result = await viaProxy(proxy.url, `http://${host}:${internal.port}/x`).catch(() => ({ status: 0, body: "" }));
      assert.equal(result.status === 200, false, `${host} 不该成功`);
      assert.doesNotMatch(result.body, new RegExp(SECRET));
    }
    assert.match(await connectVia(proxy.url, `127.0.0.1:${internal.port}`), /403/);
    assert.match(await connectVia(proxy.url, `rebind.test:${internal.port}`), /403/);
    assert.deepEqual(internal.hits, []);
    assert.ok(proxy.blocked.includes(`rebind.test:${internal.port}`));
  } finally {
    await proxy.close();
    await internal.close();
  }
});

test("出口代理：公网地址正常转发，HTTP 和 CONNECT 都用校验过的同一个解析结果去连", async () => {
  const site = await fixture((_request, respond) => respond(200, "public-ok"));
  let lookups = 0;
  const proxy = await startEgressProxy({ lookup: async () => { lookups += 1; return [PUBLIC_ADDRESS]; }, dial: toFixture(site.port) });
  try {
    const result = await viaProxy(proxy.url, "http://public.test/page");
    assert.deepEqual(result, { status: 200, body: "public-ok" });
    assert.match(await connectVia(proxy.url, "public.test:80"), /200/);
    // 每个请求只解析一次，连的就是解析出来的地址。
    assert.equal(lookups, 2);
    assert.deepEqual(proxy.blocked, []);
  } finally {
    await proxy.close();
    await site.close();
  }
});

test("出口代理：上游发出部分正文后断开，下游响应跟着中断而不是一直挂着", async () => {
  // 声明 100 字节、只发 7 字节就断开的上游。
  const upstream = createTcpServer((socket) => {
    socket.once("data", () => {
      socket.write("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 100\r\n\r\npartial");
      setTimeout(() => socket.destroy(), 20);
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const proxy = await startEgressProxy({ lookup: async () => [PUBLIC_ADDRESS], dial: toFixture((upstream.address() as AddressInfo).port) });
  try {
    const proxyUrl = new URL(proxy.url);
    const outcome = await new Promise<{ closed: boolean; complete: boolean; body: string }>((resolve) => {
      const hung = setTimeout(() => resolve({ closed: false, complete: false, body: "" }), 1_500);
      const finish = (complete: boolean, body: string) => { clearTimeout(hung); resolve({ closed: true, complete, body }); };
      const request = httpRequest({ host: proxyUrl.hostname, port: Number(proxyUrl.port), method: "GET", path: "http://public.test/cut", headers: { host: "public.test" } }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
        response.once("close", () => finish(response.complete, body));
        response.once("error", () => undefined);
      });
      request.once("error", () => finish(false, ""));
      request.end();
    });
    assert.equal(outcome.closed, true, "上游断开后下游响应要被销毁，不能一直悬挂");
    assert.equal(outcome.complete, false, "被截断的响应不能当成完整响应交给浏览器");
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => { upstream.close(() => resolve()); });
  }
});

test("出口代理：关闭后端口不再监听", async () => {
  const proxy = await startEgressProxy();
  const port = Number(new URL(proxy.url).port);
  await proxy.close();
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
  }));
});

// ---- 真实 Chromium ----

function findChromium(): string | undefined {
  const fromEnv = process.env.SURF_CHROMIUM_PATH?.trim();
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined;
  try {
    const root = effectiveBrowsersPath();
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith("chromium_headless_shell-")) continue;
      for (const inner of readdirSync(join(root, entry))) {
        const candidate = join(root, entry, inner, "chrome-headless-shell");
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch { /* 没装 */ }
  return undefined;
}

const chromiumPath = findChromium();
const realBrowser = { skip: chromiumPath ? false : "没有可用的 Chromium（设 SURF_CHROMIUM_PATH 或先装好浏览器）" };

async function withPages(run: (ctx: {
  manager: BrowserManager;
  internal: Awaited<ReturnType<typeof fixture>>;
  site: Awaited<ReturnType<typeof fixture>>;
  proxyLookups: string[];
}) => Promise<void>) {
  const internal = await fixture((_request, respond) => respond(200, `<html><body>${SECRET}</body></html>`));
  const site = await fixture((request, respond) => {
    const path = request.url ?? "/";
    if (path === "/redirect") return respond(302, "", { location: `http://127.0.0.1:${internal.port}/internal` });
    if (path.startsWith("/webrtc")) {
      // STUN 服务器指向本机 UDP 接收器：WebRTC 不走 HTTP 代理，不加限制就会直接发出 UDP 包。
      const udpPort = new URL(path, "http://x").searchParams.get("udp");
      return respond(200, `<html><body><p>${"公网页面正文。".repeat(30)}</p><script>
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }] });
        pc.createDataChannel("probe");
        pc.createOffer().then((offer) => pc.setLocalDescription(offer));
      </script></body></html>`);
    }
    if (path === "/script") {
      return respond(200, `<html><body><p>${"公网页面正文。".repeat(30)}</p><script>
        fetch("http://127.0.0.1:${internal.port}/side-effect", { mode: "no-cors" }).catch(() => {});
        fetch("http://localhost:${internal.port}/side-effect-localhost", { mode: "no-cors" }).catch(() => {});
        fetch("http://[::1]:${internal.port}/side-effect-v6", { mode: "no-cors" }).catch(() => {});
        fetch("http://public.test:${site.port}/public-data", { mode: "no-cors" }).catch(() => {});
      </script></body></html>`);
    }
    respond(200, "<html><body>ok</body></html>");
  });
  const proxyLookups: string[] = [];
  const manager = new BrowserManager({
    chromiumPath,
    pageTimeoutMs: 8_000,
    egress: {
      // Node 侧预校验只对域名放行（域名在这里“解析成公网”，IP 字面量照实判断）：测试要证明的是浏览器出口本身拦得住。
      guardLookup: async (host) => (isIP(host) ? [host] : [PUBLIC_ADDRESS]),
      lookup: async (host) => {
        proxyLookups.push(host);
        return host === "rebind.test" ? ["127.0.0.1"] : [PUBLIC_ADDRESS];
      },
      dial: toFixture(site.port),
    },
  });
  try {
    await run({ manager, internal, site, proxyLookups });
  } finally {
    await manager.close({ permanent: true });
    await site.close();
    await internal.close();
  }
}

test("真实 Chromium：公网页重定向到内网，内网服务收到 0 个请求", realBrowser, async () => {
  await withPages(async ({ manager, internal, site }) => {
    await assert.rejects(manager.render(`http://public.test:${site.port}/redirect`));
    assert.ok(site.hits.includes("GET /redirect"), "对照：公网页确实被取过");
    assert.deepEqual(internal.hits, []);
  });
});

test("真实 Chromium：页面脚本 fetch 内网（127.0.0.1 / localhost / [::1]），内网服务收到 0 个请求", realBrowser, async () => {
  await withPages(async ({ manager, internal, site }) => {
    const page = await manager.render(`http://public.test:${site.port}/script`);
    assert.match(page.html, /公网页面正文/);
    for (let i = 0; i < 40 && !site.hits.includes("GET /public-data"); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(site.hits.includes("GET /public-data"), "对照：同一段脚本里发往公网的请求照常出去了");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(internal.hits, []);
  });
});

test("真实 Chromium：页面用 WebRTC 向本机 UDP 发包也被禁止，接收器收到 0 个数据包", realBrowser, async () => {
  const packets: Buffer[] = [];
  const receiver = createSocket("udp4");
  receiver.on("message", (message) => packets.push(message));
  await new Promise<void>((resolve) => receiver.bind(0, "127.0.0.1", () => resolve()));
  const udpPort = receiver.address().port;
  try {
    await withPages(async ({ manager, site }) => {
      const page = await manager.render(`http://public.test:${site.port}/webrtc?udp=${udpPort}`);
      assert.match(page.html, /公网页面正文/, "页面本身照常渲染");
      assert.ok(site.hits.some((hit) => hit.startsWith("GET /webrtc")), "对照：公网页确实被取过");
      // 给 ICE 收集留足时间：不受限制时 STUN 请求在这段时间内就会发出。
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      assert.equal(packets.length, 0);
    });
  } finally {
    receiver.close();
  }
});

test("真实 Chromium：域名在连接时解析到内网（DNS 重绑定），内网服务收到 0 个请求", realBrowser, async () => {
  await withPages(async ({ manager, internal, proxyLookups }) => {
    // Node 侧预校验看到的是公网地址，出口代理连接时才解析到 127.0.0.1。
    const outcome = await manager.render(`http://rebind.test:${internal.port}/`).then((page) => page.html, () => "");
    assert.ok(proxyLookups.includes("rebind.test"), "对照：请求确实走到了出口代理");
    assert.doesNotMatch(outcome, new RegExp(SECRET));
    assert.deepEqual(internal.hits, []);
  });
});

test("出口代理跟浏览器一起收：关闭浏览器后代理端口释放", async () => {
  const proxies: string[] = [];
  const fake = {
    chromium: {
      async launch(options: { args?: string[] }) {
        const flag = options.args?.find((arg) => arg.startsWith("--proxy-server="));
        assert.ok(flag, "启动参数里要带 --proxy-server");
        assert.ok(options.args?.includes("--proxy-bypass-list=<-loopback>"), "要取消对回环地址的隐式绕过");
        assert.ok(options.args?.includes("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"), "WebRTC 不能绕开代理直接发 UDP");
        proxies.push(flag.slice("--proxy-server=".length));
        return {
          async newContext() { throw new Error("不会走到"); },
          async close() {},
        };
      },
    },
  };
  const manager = new BrowserManager({ chromiumModule: fake, allowPrivateHosts: true });
  await assert.rejects(manager.render("http://example.com/"));
  assert.equal(proxies.length, 1);
  const port = Number(new URL(proxies[0]).port);
  await manager.close({ permanent: true });
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
  }));
});
