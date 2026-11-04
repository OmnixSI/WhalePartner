import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const APP_DIR = resolve(import.meta.dirname, "..");
const REPO_DIR = resolve(APP_DIR, "../..");
const LOCAL_DIR = resolve(REPO_DIR, ".local");
const SESSION_PATH = resolve(LOCAL_DIR, "bilibili-session.json");
const PENDING_PATH = resolve(LOCAL_DIR, "bilibili-login-pending.json");
const QR_PATH = resolve(LOCAL_DIR, "bilibili-login.png");
const QR_GENERATOR_PATH = resolve(APP_DIR, "tools/qr-code.swift");
const PASSPORT_BASE = "https://passport.bilibili.com/x/passport-login/web";
const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const POLL_INTERVAL_MS = 3000;
const LOGIN_TIMEOUT_MS = 180_000;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Origin: "https://www.bilibili.com",
  Referer: "https://www.bilibili.com/",
};

type BilibiliSession = {
  sessdata: string;
  savedAt: string;
};

type QrPayload = {
  code?: number;
  message?: string;
  data?: {
    url?: string;
    qrcode_key?: string;
  };
};

type LoginResult = {
  status: "waiting" | "scanned" | "expired" | "success" | "error";
  sessdata?: string;
};

const runFile = promisify(execFile);

function parseSetCookies(lines: string[]) {
  const cookies = new Map<string, string>();
  for (const line of lines) {
    const pair = line.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return cookies;
}

function findSessdata(urlText: string | undefined) {
  const pending = [urlText ?? ""];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const candidate = pending.shift() ?? "";
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }

    const sessdata = url.searchParams.get("SESSDATA");
    if (sessdata) return sessdata;

    for (const value of url.searchParams.values()) {
      let decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        // Keep the original parameter when it is not a valid encoded URL.
      }
      if (/crossDomain|SESSDATA|passport/i.test(decoded)) pending.push(decoded);
    }
  }

  return undefined;
}

async function readJson(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} 请求失败（HTTP ${response.status}）。`);
  try {
    return await response.json() as Record<string, any>;
  } catch {
    throw new Error(`${label} 返回了无法解析的数据。`);
  }
}

async function renderQrCode(loginUrl: string) {
  if (process.platform !== "darwin") {
    throw new Error("本地原型的二维码渲染需要 macOS Core Image。");
  }

  await mkdir(LOCAL_DIR, { recursive: true, mode: 0o700 });
  const cacheDir = resolve(LOCAL_DIR, "swift-module-cache");
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await runFile("swift", ["-module-cache-path", cacheDir, QR_GENERATOR_PATH, loginUrl, QR_PATH], {
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: cacheDir,
      SWIFT_MODULECACHE_PATH: cacheDir,
    },
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  await chmod(QR_PATH, 0o600);
}

export function bilibiliSessionPath() {
  return SESSION_PATH;
}

export async function loadBilibiliSession(): Promise<BilibiliSession | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(SESSION_PATH, "utf8"));
    if (
      typeof parsed === "object" && parsed !== null &&
      "sessdata" in parsed && typeof parsed.sessdata === "string" && parsed.sessdata.length > 0
    ) {
      return {
        sessdata: parsed.sessdata,
        savedAt: "savedAt" in parsed && typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      };
    }
    throw new Error("本地 B 站登录文件格式无效，请重新运行 login。");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function isBilibiliSessionValid(sessdata: string) {
  const response = await fetch(NAV_URL, {
    headers: {
      ...HEADERS,
      Cookie: `SESSDATA=${sessdata}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readJson(response, "B 站登录状态验证");
  return body.code === 0 && body.data?.isLogin === true;
}

async function generateLoginQr() {
  const response = await fetch(`${PASSPORT_BASE}/qrcode/generate?source=main-fe-header`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readJson(response, "B 站二维码生成");
  const payload = body as QrPayload;
  if (payload.code !== 0 || !payload.data?.url || !payload.data.qrcode_key) {
    throw new Error(`B 站二维码生成失败（${payload.message ?? payload.code ?? "未知响应"}）。`);
  }

  await renderQrCode(payload.data.url);
  return payload.data.qrcode_key;
}

async function pollLogin(qrcodeKey: string): Promise<LoginResult> {
  const url = new URL(`${PASSPORT_BASE}/qrcode/poll`);
  url.searchParams.set("qrcode_key", qrcodeKey);
  url.searchParams.set("source", "main-fe-header");

  const response = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15_000),
  });
  const setCookies = response.headers.getSetCookie();
  const body = await readJson(response, "B 站二维码状态查询");
  const statusCodes = new Map<number, LoginResult["status"]>([
    [86101, "waiting"],
    [86090, "scanned"],
    [86038, "expired"],
  ]);

  if (body.code !== 0) {
    return { status: statusCodes.get(Number(body.code)) ?? "error" };
  }

  const data = body.data ?? {};
  const dataCode = Number(data.code);
  if (dataCode === 0) {
    const sessdata = findSessdata(data.url) ?? parseSetCookies(setCookies).get("SESSDATA");
    return sessdata ? { status: "success", sessdata } : { status: "error" };
  }
  return { status: statusCodes.get(dataCode) ?? "error" };
}

async function saveSession(sessdata: string) {
  await mkdir(LOCAL_DIR, { recursive: true, mode: 0o700 });
  const session: BilibiliSession = { sessdata, savedAt: new Date().toISOString() };
  await writeFile(SESSION_PATH, JSON.stringify(session, null, 2) + "\n", { mode: 0o600 });
  await chmod(SESSION_PATH, 0o600);
}

export async function startBilibiliLogin(onQrReady: (path: string) => void) {
  const qrcodeKey = await generateLoginQr();
  await mkdir(LOCAL_DIR, { recursive: true, mode: 0o700 });
  await writeFile(
    PENDING_PATH,
    JSON.stringify({ qrcodeKey, createdAt: new Date().toISOString() }, null, 2) + "\n",
    { mode: 0o600 },
  );
  await chmod(PENDING_PATH, 0o600);
  onQrReady(QR_PATH);
}

async function loadPendingLogin() {
  try {
    return JSON.parse(await readFile(PENDING_PATH, "utf8")) as { qrcodeKey: string; createdAt: string };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new Error("没有待确认的 B 站登录二维码，请先运行 login。");
    }
    throw error;
  }
}

async function clearPendingLogin() {
  await rm(PENDING_PATH, { force: true });
  await rm(QR_PATH, { force: true });
}

export async function waitForBilibiliLogin(onScanned: () => void) {
  const pending = await loadPendingLogin();
  const createdAt = Date.parse(pending.createdAt);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt >= LOGIN_TIMEOUT_MS) {
    await clearPendingLogin();
    throw new Error("二维码已过期，请重新运行 login。");
  }

  const deadline = createdAt + LOGIN_TIMEOUT_MS;
  let scannedNotified = false;
  while (Date.now() < deadline) {
    const result = await pollLogin(pending.qrcodeKey);
    if (result.status === "success" && result.sessdata) {
      if (!(await isBilibiliSessionValid(result.sessdata))) {
        await clearPendingLogin();
        throw new Error("B 站未返回有效的登录态，请重新运行 login。");
      }
      await saveSession(result.sessdata);
      await clearPendingLogin();
      return;
    }
    if (result.status === "expired") {
      await clearPendingLogin();
      throw new Error("二维码已过期，请重新运行 login。");
    }
    if (result.status === "error") {
      await clearPendingLogin();
      throw new Error("B 站二维码登录状态异常，请重新运行 login。");
    }
    if (result.status === "scanned" && !scannedNotified) {
      scannedNotified = true;
      onScanned();
    }
    await delay(POLL_INTERVAL_MS);
  }
  await clearPendingLogin();
  throw new Error("等待扫码超过 3 分钟，请重新运行 login。");
}

export async function logoutFromBilibili() {
  await rm(SESSION_PATH, { force: true });
  await clearPendingLogin();
}
