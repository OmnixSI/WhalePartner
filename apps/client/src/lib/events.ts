/**
 * 实时事件订阅（统一入口）：整个 App 只开一条 `GET /api/events`（SSE）。
 * EventSource 带不了请求头，令牌走 `?token=`；断线自动重连并带 Last-Event-ID 补齐；
 * hub 说缓冲已经滚过头（resync）、或页面从后台回来，都会向订阅者广播一次 `resync`，由各自整体重拉。
 */
import { API_BASE, authedUrl, backendReady } from "./api";

export type HubEventType =
  | "message.created" | "message.delta" | "message.done" | "message.interrupted" | "typing"
  | "diary.updated" | "memory.updated" | "surf.item" | "settings.updated" | "resync";

export interface HubEventData {
  character?: string;
  sessionId?: string;
  clientId?: string;
  streamId?: string;
  [key: string]: unknown;
}

type Handler = (type: HubEventType, data: HubEventData) => void;

const TYPES: HubEventType[] = [
  "message.created", "message.delta", "message.done", "message.interrupted", "typing",
  "diary.updated", "memory.updated", "surf.item", "settings.updated", "resync",
];

const handlers = new Set<Handler>();
let source: EventSource | null = null;
let lastId = "";
let retry: ReturnType<typeof setTimeout> | undefined;
let backoff = 1000;
let hasOpened = false;
export type HubStatus = "connecting" | "open" | "down";
let status: HubStatus = "connecting";
const statusListeners = new Set<(s: HubStatus) => void>();

function setStatus(next: HubStatus) {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener(next);
}

function emit(type: HubEventType, data: HubEventData) {
  for (const handler of handlers) {
    try { handler(type, data); } catch (error) { console.warn("事件处理失败：", error); }
  }
}

async function connect() {
  if (source || handlers.size === 0) return;
  await backendReady;
  if (source || handlers.size === 0) return;
  setStatus("connecting");
  const query = lastId ? `?lastEventId=${encodeURIComponent(lastId)}` : "";
  const es = new EventSource(authedUrl(`${API_BASE}/api/events${query}`));
  source = es;
  es.onopen = () => {
    backoff = 1000;
    setStatus("open");
    // 重连成功且中间可能漏过东西（EventSource 自己重连会带 Last-Event-ID；手动重建则靠 lastId 查询串）。
    if (hasOpened) emit("resync", { reason: "reconnected" });
    hasOpened = true;
  };
  for (const type of TYPES) {
    es.addEventListener(type, (raw) => {
      const message = raw as MessageEvent<string>;
      if (message.lastEventId) lastId = message.lastEventId;
      let data: HubEventData = {};
      try { data = JSON.parse(message.data) as HubEventData; } catch { return; }
      if (type === "resync") {
        // hub 缓冲滚过头或重启过（id 又从 1 数起）：手里的旧 id 作废，换成 hub 现在的位置。
        // 这条连接自己重连时还会带着旧的 Last-Event-ID，所以按新位置重建一次；各页面照常收到这次 resync 去整体重拉。
        const current = Number(data.lastId);
        lastId = Number.isInteger(current) && current > 0 ? String(current) : "";
        disconnect();
        hasOpened = false;
        void connect();
      }
      emit(type, data);
    });
  }
  es.onerror = () => {
    setStatus("down");
    // 浏览器自己会重连；但 401/网络层永久失败会变成 CLOSED，这时手动退避重建。
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      source = null;
      clearTimeout(retry);
      retry = setTimeout(() => void connect(), backoff);
      backoff = Math.min(30_000, backoff * 2);
    }
  };
}

function disconnect() {
  clearTimeout(retry);
  source?.close();
  source = null;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || handlers.size === 0) return;
    if (!source || source.readyState === EventSource.CLOSED) {
      disconnect();
      void connect();
    }
    emit("resync", { reason: "visible" });
  });
  window.addEventListener("online", () => {
    if (handlers.size === 0) return;
    disconnect();
    void connect();
  });
  window.addEventListener("wp:connection-changed", () => {
    disconnect();
    lastId = "";
    hasOpened = false;
    void connect();
  });
}

export function subscribeHub(handler: Handler): () => void {
  handlers.add(handler);
  void connect();
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) disconnect();
  };
}

export function onHubStatus(listener: (s: HubStatus) => void): () => void {
  statusListeners.add(listener);
  listener(status);
  return () => { statusListeners.delete(listener); };
}
