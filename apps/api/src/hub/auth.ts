/**
 * 鉴权与跨站防护。
 *
 * - 除 `/api/health` 与 `/api/pair/redeem` 外都要鉴权。
 * - 凭据：`Authorization: Bearer <token>`（EventSource 与 <img> 不能带头，GET 也接受 `?token=`）。
 *   token 可以是环境变量 `WP_LOCAL_TOKEN`，或已配对设备的 token。
 * - 没设 `WP_LOCAL_TOKEN` 且没开 `--lan` 时保持开发便利：来自本机回环、且没带代理转发头的请求不要 token；
 *   但一旦请求像是经隧道/反代来的（x-forwarded-for / cf-connecting-ip 等）或来自非回环地址，一律要 token。
 * - 不管有没有 token，都拒绝跨站 Origin，以及跨站表单能发的简单请求体（text/plain 等）。
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";
import type { DeviceRegistry } from "./devices.ts";
import { CORS_ALLOWED_ORIGINS } from "../server/http.ts";

export interface AuthOptions {
  /** 本机 token（WP_LOCAL_TOKEN）。 */
  localToken?: string;
  /** --lan：必须带 token。 */
  lan?: boolean;
  devices?: DeviceRegistry;
  /** 额外允许的 Origin（逗号分隔环境变量 WP_ALLOWED_ORIGINS）。 */
  extraOrigins?: string[];
  /** 额外允许的 Host（通过域名访问 hub 时）。 */
  extraHosts?: string[];
}

export type AuthVerdict =
  | { ok: true; via: "open" | "local" | "device"; deviceId?: string }
  | { ok: false; status: 401 | 403; error: string; code: string };

const PUBLIC_PATHS = new Set(["/api/health", "/api/pair/redeem"]);
const FORWARD_HEADERS = ["x-forwarded-for", "x-forwarded-host", "forwarded", "cf-connecting-ip", "cf-ray", "x-real-ip"];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "tauri.localhost"]);
const SIMPLE_TYPES = /^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)/i;

export function authOptionsFromEnv(lan: boolean, devices: DeviceRegistry): AuthOptions {
  const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return {
    localToken: process.env.WP_LOCAL_TOKEN?.trim() || undefined,
    lan,
    devices,
    extraOrigins: list(process.env.WP_ALLOWED_ORIGINS),
    extraHosts: list(process.env.WP_ALLOWED_HOSTS),
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function extractToken(request: IncomingMessage, url: URL): string {
  const header = request.headers.authorization;
  if (typeof header === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  if (request.method === "GET" || request.method === "HEAD") return url.searchParams.get("token") ?? "";
  return "";
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return !address || address === "::1" || address.startsWith("127.") || address === "::ffff:127.0.0.1";
}

/** 配置的代理网段（WP_TRUSTED_PROXIES，逗号分隔的地址或 CIDR）。 */
export function trustedProxiesFromEnv(): string[] {
  return (process.env.WP_TRUSTED_PROXIES ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

/** 去掉方括号、端口、zone id，并把 IPv4-mapped IPv6（::ffff:127.0.0.1）还原成 IPv4。 */
function normalizeAddress(value: string): string {
  let address = value.trim().toLowerCase();
  if (address.startsWith("[")) {
    const end = address.indexOf("]");
    if (end > 0) address = address.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(address)) {
    address = address.slice(0, address.lastIndexOf(":"));
  }
  const zone = address.indexOf("%");
  if (zone > 0) address = address.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  return mapped ? mapped[1] : address;
}

function isLoopbackHost(address: string): boolean {
  return address === "::1" || address.startsWith("127.");
}

function matchesConfiguredProxy(address: string, entries: string[]): boolean {
  const family = isIP(address);
  if (!family || entries.length === 0) return false;
  const list = new BlockList();
  let added = false;
  for (const entry of entries) {
    const [rawAddress, rawPrefix] = entry.split("/");
    const host = normalizeAddress(rawAddress ?? "");
    const hostFamily = isIP(host);
    if (!hostFamily) continue;
    const prefix = rawPrefix === undefined ? (hostFamily === 4 ? 32 : 128) : Number.parseInt(rawPrefix, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (hostFamily === 4 ? 32 : 128)) continue;
    list.addSubnet(host, prefix, hostFamily === 4 ? "ipv4" : "ipv6");
    added = true;
  }
  return added && list.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** TCP 对端是不是可信代理：本机回环（本地隧道/反代），或 WP_TRUSTED_PROXIES 里配置的网段。 */
export function isTrustedProxy(address: string, trustedProxies: string[] = []): boolean {
  const peer = normalizeAddress(address);
  if (!peer) return false;
  return isLoopbackHost(peer) || matchesConfiguredProxy(peer, trustedProxies);
}

function headerValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * 请求的来源地址，用于按地址限流。
 * 只有 TCP 对端是可信代理时才看转发头——直连的客户端可以随便写 X-Forwarded-For，
 * 采信它等于让攻击者每次换一个来源桶。代理后面只看 x-forwarded-for，从右往左取第一个不可信的地址
 * （右边的值由最近的代理追加）。
 * 不采信 cf-connecting-ip / x-real-ip：Caddy、nginx 默认会把客户端自带的这两个头原样转给后端，
 * 可信代理后面的客户端照样能伪造；而 Cloudflare 和常见反代都会追加 X-Forwarded-For，用它就够了。
 */
export function clientAddress(request: IncomingMessage, trustedProxies: string[] = []): string {
  const peer = normalizeAddress(request.socket.remoteAddress ?? "");
  if (!isTrustedProxy(peer, trustedProxies)) return peer;

  const forwarded = headerValue(request.headers["x-forwarded-for"]);
  if (forwarded) {
    const chain = forwarded.split(",").map(normalizeAddress).filter(Boolean);
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      if (!isTrustedProxy(chain[index], trustedProxies)) return chain[index];
    }
    if (chain.length > 0) return chain[0];
  }
  return peer;
}

function hostName(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

/** Origin 是否可信：白名单、环境变量、或与 Host 同源。 */
export function originAllowed(request: IncomingMessage, options: AuthOptions): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return true; // 非浏览器或同源 GET：没有 Origin
  if (CORS_ALLOWED_ORIGINS.includes(origin) || options.extraOrigins?.includes(origin)) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch { return false; }
}

export function authorize(request: IncomingMessage, url: URL, options: AuthOptions): AuthVerdict {
  const path = url.pathname;
  if (request.method === "OPTIONS") return { ok: true, via: "open" };

  if (!originAllowed(request, options)) {
    return { ok: false, status: 403, code: "cross_origin", error: "拒绝来自其他网站的请求。" };
  }
  const write = request.method !== "GET" && request.method !== "HEAD";
  const type = request.headers["content-type"];
  if (write && typeof type === "string" && SIMPLE_TYPES.test(type)) {
    return { ok: false, status: 403, code: "bad_content_type", error: "请求必须是 application/json。" };
  }
  if (PUBLIC_PATHS.has(path) && (path === "/api/health" ? request.method === "GET" : request.method === "POST")) {
    return { ok: true, via: "open" };
  }
  // 非 /api 路径（静态页面、manifest）不含数据，放行。
  if (!path.startsWith("/api/") && path !== "/api") return { ok: true, via: "open" };

  const token = extractToken(request, url);
  if (token) {
    if (options.localToken && safeEqual(token, options.localToken)) return { ok: true, via: "local" };
    const device = options.devices?.verify(token);
    if (device) return { ok: true, via: "device", deviceId: device.id };
    return { ok: false, status: 401, code: "bad_token", error: "令牌无效或已被撤销。" };
  }

  const proxied = FORWARD_HEADERS.some((name) => request.headers[name] !== undefined);
  const local = isLoopbackAddress(request.socket.remoteAddress) && !proxied;
  if (!options.localToken && !options.lan && local) {
    // 开发便利模式：Host 必须是回环名，防 DNS rebinding。
    const host = hostName(request.headers.host ?? "");
    if (!LOOPBACK_HOSTS.has(host) && !options.extraHosts?.includes(host)) {
      return { ok: false, status: 403, code: "bad_host", error: "不认识的访问域名。" };
    }
    return { ok: true, via: "open" };
  }
  return { ok: false, status: 401, code: "unauthorized", error: "需要先连接到你的鲸汐（缺少令牌）。" };
}

/** 健康检查里告诉客户端：这个 hub 要不要令牌。 */
export function authRequiredFor(request: IncomingMessage, options: AuthOptions): boolean {
  const proxied = FORWARD_HEADERS.some((name) => request.headers[name] !== undefined);
  return Boolean(options.localToken) || Boolean(options.lan) || proxied || !isLoopbackAddress(request.socket.remoteAddress);
}
