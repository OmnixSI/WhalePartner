/**
 * 后端地址与鉴权的唯一出口。
 *
 * 一个用户 = 一个「家」后端（hub）。基址按优先级解析：
 *   1. 用户在设置里配置了远程服务器（localStorage `wp.hub`）→ 用它，带设备 token；
 *   2. 在 Tauri 里 → `invoke('backend_info')` 返回 `{url, token}`（Rust 端实现）；
 *      调用失败就回退 http://127.0.0.1:8787、无 token；
 *   3. 否则同源 `/api`（Vite 代理，或 hub 自己托管的网页端）。
 *
 * 所有走 `/api` 的 fetch 都会被这里包一层：等基址解析完、改写成真实基址、加 `Authorization: Bearer`。
 * 因此各处仍然可以写 `fetch(`${API_BASE}/api/...`)`，不必各自操心令牌。
 * `<img>` / `EventSource` 带不了请求头，用 `authedUrl()` 给地址补 `?token=`。
 */

export interface HubConnection {
  /** 空串 = 同源。 */
  url: string;
  token: string;
  name?: string;
}

const STORE_KEY = "wp.hub";
const LOCAL_DEFAULT = "http://127.0.0.1:8787";
const envBase = (import.meta.env?.VITE_API_BASE as string | undefined) || undefined;
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function readStored(): HubConnection | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HubConnection>;
    if (typeof parsed.url !== "string" || typeof parsed.token !== "string") return null;
    return { url: parsed.url.replace(/\/+$/, ""), token: parsed.token, name: parsed.name };
  } catch {
    return null;
  }
}

const stored = readStored();

/** 实时绑定：其他模块里的 `${API_BASE}` 每次求值都拿最新值。 */
export let API_BASE: string = stored ? stored.url : (envBase ?? (inTauri ? LOCAL_DEFAULT : ""));
let token = stored?.token ?? "";
/** 历史上出现过的基址：fetch 包装据此认出「这是发给后端的请求」。 */
const knownBases = new Set<string>(["", LOCAL_DEFAULT, API_BASE]);

export function currentToken(): string {
  return token;
}

/** 当前是不是连着用户自己配置的远程 hub。 */
export function remoteConnection(): HubConnection | null {
  return readStored();
}

interface BackendInfoPayload {
  url?: string;
  token?: string;
}

/**
 * 应用桌面壳给的后端信息：启动时的 backend_info，或后端换端口重启后的 backend-ready。
 * 新基址必须进 knownBases，否则 fetch 包装认不出这是后端请求，既不改写地址也不带令牌。
 * 地址或令牌变了就广播连接变更：EventSource 重连，页面重新拉健康和聊天历史。
 */
function applyBackendInfo(info: BackendInfoPayload | null | undefined, notify = true) {
  const url = info?.url?.replace(/\/+$/, "");
  const nextToken = typeof info?.token === "string" ? info.token : token;
  const changed = (Boolean(url) && url !== API_BASE) || nextToken !== token;
  if (url) {
    API_BASE = url;
    knownBases.add(url);
  }
  token = nextToken;
  if (notify && changed && typeof window !== "undefined") window.dispatchEvent(new Event("wp:connection-changed"));
}

async function resolveTauri(): Promise<void> {
  try {
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
    ]);
    let readySeen = false;
    try {
      // 先挂监听再取当前值：后端可能在两次调用之间换端口就绪，反过来会漏掉 backend-ready。
      await listen<BackendInfoPayload>("backend-ready", (event) => {
        readySeen = true;
        applyBackendInfo(event.payload);
      });
    } catch {
      // 监听注册失败不拦启动：仍用 backend_info 连当前后端；真换了端口，下次启动也能恢复。
    }
    const info = await invoke<BackendInfoPayload>("backend_info");
    // 等 invoke 返回期间若已收到 ready，以事件里的新地址为准，别被更旧的返回值覆盖。
    if (!readySeen) applyBackendInfo(info, false);
  } catch {
    // Rust 端还没实现 / 调用失败：回退到本机默认地址，不带 token。
    API_BASE = LOCAL_DEFAULT;
    token = "";
  }
}

/** 基址解析完成。非 Tauri 或已配置远程时是立即 resolved。 */
export const backendReady: Promise<void> = !stored && inTauri && envBase === undefined ? resolveTauri() : Promise.resolve();

/** 保存/清除「连接到我的鲸汐」。调用方通常随后 `location.reload()`。 */
export function setRemoteConnection(connection: HubConnection | null) {
  try {
    if (connection) localStorage.setItem(STORE_KEY, JSON.stringify({ ...connection, url: connection.url.replace(/\/+$/, "") }));
    else localStorage.removeItem(STORE_KEY);
  } catch { /* 隐私模式 */ }
  if (connection) {
    API_BASE = connection.url.replace(/\/+$/, "");
    token = connection.token;
  } else {
    API_BASE = envBase ?? (inTauri ? LOCAL_DEFAULT : "");
    token = "";
  }
  knownBases.add(API_BASE);
  window.dispatchEvent(new Event("wp:connection-changed"));
}

/** 给 <img src> / EventSource 用：把令牌放进查询串。 */
export function authedUrl(url: string): string {
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

function apiPath(raw: string): string | null {
  for (const base of knownBases) {
    if (raw.startsWith(`${base}/api/`) || raw === `${base}/api`) return raw.slice(base.length);
  }
  return null;
}

if (typeof window !== "undefined" && !(window as unknown as { __wpFetchPatched?: boolean }).__wpFetchPatched) {
  (window as unknown as { __wpFetchPatched?: boolean }).__wpFetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : null;
    const path = raw ? apiPath(raw) : null;
    if (raw === null || path === null) return nativeFetch(input, init);
    await backendReady;
    const headers = new Headers(init?.headers);
    if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    const response = await nativeFetch(`${API_BASE}${path}`, { ...init, headers });
    if (response.status === 401 && !path.startsWith("/api/pair/")) window.dispatchEvent(new Event("wp:auth-required"));
    return response;
  };
}

export interface Health {
  ok: boolean;
  provider?: string;
  model?: string;
  /** hub 要求令牌（--lan、WP_LOCAL_TOKEN、或经隧道访问）。 */
  authRequired?: boolean;
}

/** 后端状态探测。服务不存在时返回 null，界面显示「未连接」。 */
export async function fetchHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

/** 用配对码向某个 hub 换取长期设备 token（该请求不需要鉴权）。 */
export async function pairWithHub(url: string, code: string, deviceName: string): Promise<HubConnection> {
  const base = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base) && base !== "") throw new Error("地址要以 http:// 或 https:// 开头。");
  let response: Response;
  try {
    response = await fetch(`${base}/api/pair/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim(), name: deviceName }),
    });
  } catch {
    throw new Error("连不上这个地址。检查地址和网络，或确认家里的鲸汐正在运行。");
  }
  const body = (await response.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!response.ok || !body.token) throw new Error(body.message ?? `配对失败（HTTP ${response.status}）。`);
  return { url: base, token: body.token, name: deviceName };
}

export function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android 手机" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows 电脑" : /Linux/.test(ua) ? "Linux 电脑" : "新设备";
  return inTauri ? `${os}（桌面 App）` : `${os}（浏览器）`;
}

/**
 * 扫码入口：手机相机扫到 `http://hub地址/?pair=123456` 打开网页端时，自动用同源 hub 配对，
 * 存下设备 token，然后去掉地址栏里的配对码。
 */
export async function pairFromLocation(): Promise<boolean> {
  if (typeof window === "undefined" || inTauri) return false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("pair");
  if (!code || !/^\d{6}$/.test(code)) return false;
  try {
    const connection = await pairWithHub(window.location.origin, code, defaultDeviceName());
    setRemoteConnection({ ...connection, url: window.location.origin });
    params.delete("pair");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== "undefined" && !inTauri && new URLSearchParams(window.location.search).has("pair")) {
  void pairFromLocation().then((ok) => { if (ok) window.location.reload(); });
}
