import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, createServer, type IncomingMessage, type Server } from "node:http";
import { connect, isIP, type AddressInfo, type Socket } from "node:net";
import { isPrivateAddress } from "../webpage/service.ts";

/**
 * 只给无头浏览器用的出口代理（监听 127.0.0.1 的随机端口，生命周期跟浏览器走）。
 *
 * Chromium 的所有网络请求——导航、重定向、页面脚本里的 fetch——都先到这里：
 * 代理在**建立连接时**解析目标主机名、检查每个地址，然后直接用解析出来的这个地址去连，
 * 不再让 Chromium 自己解析一遍。所以内网地址、解析到内网的域名和 DNS 重绑定都在连接前就被拒，
 * 内网服务一个请求也收不到。
 *
 * 浏览器启动时要配合 `--proxy-bypass-list=<-loopback>`，否则 Chromium 对 127.0.0.1 / localhost
 * 默认不走代理，直接就连上本机服务了。
 */

export interface EgressProxyOptions {
  /** 只给测试夹具用：不拦内网地址。 */
  allowPrivate?: boolean;
  /** 只给测试用：替换 DNS 解析。 */
  lookup?: (host: string) => Promise<string[]>;
  /** 只给测试用：把已校验过的公网地址改成实际要连的地址。 */
  dial?: (address: string, port: number) => { host: string; port: number };
}

export interface EgressProxy {
  /** 浏览器的 `--proxy-server` 参数值。 */
  readonly url: string;
  /** 被拒绝的目标（host:port），排查和测试用。 */
  readonly blocked: readonly string[];
  close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 10_000;

async function defaultLookup(host: string): Promise<string[]> {
  return (await dnsLookup(host, { all: true })).map((entry) => entry.address);
}

const bare = (host: string) => host.replace(/^\[|\]$/g, "").toLowerCase();

class Blocked extends Error {}

/** 解析并校验目标：返回可以连的地址（全部通过检查），任何一个是内网地址就整体拒绝。 */
async function resolveTarget(host: string, options: EgressProxyOptions): Promise<string[]> {
  const name = bare(host);
  if (!name) throw new Blocked("空主机名");
  const literal = isIP(name) !== 0;
  if (!literal && !options.allowPrivate && (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local") || name.endsWith(".internal"))) {
    throw new Blocked("内部主机名");
  }
  const addresses = literal ? [name] : await (options.lookup ?? defaultLookup)(name);
  if (addresses.length === 0) throw new Blocked("解析不到地址");
  if (!options.allowPrivate && addresses.some((address) => isPrivateAddress(address))) throw new Blocked("指向内部网络");
  return addresses;
}

function dial(options: EgressProxyOptions, address: string, port: number): { host: string; port: number } {
  return options.dial ? options.dial(address, port) : { host: address, port };
}

/** 按顺序试每个已校验的地址，用第一个连上的。 */
function connectAny(addresses: string[], port: number, options: EgressProxyOptions): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let index = 0;
    const next = (lastError?: Error) => {
      if (index >= addresses.length) return reject(lastError ?? new Error("连不上"));
      const target = dial(options, addresses[index++], port);
      const socket = connect({ host: target.host, port: target.port, timeout: CONNECT_TIMEOUT_MS });
      socket.once("connect", () => {
        socket.setTimeout(0);
        socket.removeAllListeners("error");
        socket.removeAllListeners("timeout");
        resolve(socket);
      });
      socket.once("error", (error) => next(error));
      socket.once("timeout", () => {
        socket.destroy();
        next(new Error("连接超时"));
      });
    };
    next();
  });
}

/** CONNECT 的 authority 是 host:port，端口必填；缺省按 443。不能交给 URL 解析：它会把 http 的 :80 当成默认端口吃掉。 */
function splitHostPort(authority: string, defaultPort: number): { host: string; port: number } | null {
  const match = /^(\[[^\]]+\]|[^:\[\]]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : defaultPort;
  return port > 0 && port <= 65535 ? { host: match[1], port } : null;
}

const HOP_BY_HOP = new Set(["proxy-connection", "proxy-authorization", "proxy-authenticate", "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade"]);

export async function startEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const blocked: string[] = [];
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };

  const server: Server = createServer((clientRequest, clientResponse) => {
    void (async () => {
      let target: URL;
      try {
        target = new URL(clientRequest.url ?? "");
        if (target.protocol !== "http:") throw new Error("只代理 http");
      } catch {
        clientResponse.writeHead(400).end();
        return;
      }
      const port = target.port ? Number(target.port) : 80;
      try {
        const addresses = await resolveTarget(target.hostname, options);
        const upstream = dial(options, addresses[0], port);
        const headers = Object.fromEntries(Object.entries(clientRequest.headers).filter(([key]) => !HOP_BY_HOP.has(key)));
        const forward = httpRequest({
          host: upstream.host,
          port: upstream.port,
          method: clientRequest.method,
          path: `${target.pathname}${target.search}`,
          headers: { ...headers, connection: "close" },
        }, (response: IncomingMessage) => {
          const responseHeaders = Object.fromEntries(Object.entries(response.headers).filter(([key]) => !HOP_BY_HOP.has(key)));
          clientResponse.writeHead(response.statusCode ?? 502, responseHeaders);
          response.pipe(clientResponse);
        });
        forward.setTimeout(CONNECT_TIMEOUT_MS * 3, () => forward.destroy());
        forward.once("error", () => {
          if (!clientResponse.headersSent) clientResponse.writeHead(502).end();
          else clientResponse.destroy();
        });
        clientResponse.once("close", () => forward.destroy());
        clientRequest.pipe(forward);
      } catch (error) {
        if (error instanceof Blocked) blocked.push(`${target.hostname}:${port}`);
        if (!clientResponse.headersSent) clientResponse.writeHead(error instanceof Blocked ? 403 : 502).end();
      }
    })();
  });

  server.on("connect", (clientRequest: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    track(clientSocket);
    clientSocket.on("error", () => clientSocket.destroy());
    void (async () => {
      const parsed = splitHostPort(clientRequest.url ?? "", 443);
      if (!parsed) {
        clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      let upstream: Socket;
      try {
        const addresses = await resolveTarget(parsed.host, options);
        upstream = await connectAny(addresses, parsed.port, options);
      } catch (error) {
        if (error instanceof Blocked) blocked.push(`${parsed.host}:${parsed.port}`);
        clientSocket.end(`HTTP/1.1 ${error instanceof Blocked ? "403 Forbidden" : "502 Bad Gateway"}\r\n\r\n`);
        return;
      }
      track(upstream);
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.once("close", () => upstream.destroy());
      upstream.once("close", () => clientSocket.destroy());
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    })();
  });
  server.on("connection", track);
  server.on("clientError", (_error, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | null = null;
  return {
    url: `http://127.0.0.1:${port}`,
    blocked,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}
