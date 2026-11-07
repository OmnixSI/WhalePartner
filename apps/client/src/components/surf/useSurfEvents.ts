/**
 * `useSurfEvents`（规范 §10.6.7）：用 fetch 流读 `/api/surf/events`，不用 EventSource
 * （Tauri 下要拼 API_BASE，也想自己控制断开）。断线退避 2→4→8→16→30 秒；
 * 页面不可见时断开，回来时重连并让调用方先对齐一次 `/api/surf/status`。
 */
import { useEffect, useRef } from "react";
import { API_BASE } from "../../lib/api";

export type SurfStage = "searching" | "watching" | "reading" | "writing";

export interface SurfSessionEvent {
  state: "start" | "end";
  sessionId: number;
  kinds: Array<"video" | "web">;
  count?: number;
}

export interface SurfStepEvent {
  sessionId: number;
  stage: SurfStage;
  kind: "video" | "web" | null;
}

export interface SurfItemEvent {
  id: number;
  kind: "video" | "web";
  title: string;
  sourceSite: string;
  thumb: string | null;
  thumbError: string | null;
  comment: string;
  createdAt: string;
}

export interface SurfShareEvent {
  itemId: number;
  messageId: number;
}

export interface SurfEventHandlers {
  onSession?: (event: SurfSessionEvent) => void;
  onStep?: (event: SurfStepEvent) => void;
  onItem?: (event: SurfItemEvent) => void;
  onShare?: (event: SurfShareEvent) => void;
  /** 每次（重新）连上时调用，用来对齐一次状态。 */
  onOpen?: () => void;
}

const BACKOFF = [2000, 4000, 8000, 16000, 30000];

export function useSurfEvents(character: string, handlers: SurfEventHandlers, enabled = true) {
  // 用 ref 接住回调，避免每次渲染都重新连一次。
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled || !character) return;
    let closed = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let timer: number | null = null;

    const dispatch = (event: string, data: unknown) => {
      const current = latest.current;
      if (event === "session") current.onSession?.(data as SurfSessionEvent);
      else if (event === "step") current.onStep?.(data as SurfStepEvent);
      else if (event === "item") current.onItem?.(data as SurfItemEvent);
      else if (event === "share") current.onShare?.(data as SurfShareEvent);
    };

    const connect = async () => {
      if (closed || document.visibilityState === "hidden") return;
      controller = new AbortController();
      try {
        const response = await fetch(`${API_BASE}/api/surf/events?character=${encodeURIComponent(character)}`, {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        });
        if (!response.ok || !response.body) throw new Error(`events ${response.status}`);
        attempt = 0;
        latest.current.onOpen?.();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // 帧之间用空行分隔；注释帧（`: ping`）事件名是空串。
          let split = buffer.indexOf("\n\n");
          while (split !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            let name = "";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) name = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (name && data) {
              try {
                dispatch(name, JSON.parse(data));
              } catch {
                /* 坏帧丢掉，不影响后面的 */
              }
            }
            split = buffer.indexOf("\n\n");
          }
        }
      } catch {
        /* 断线 -> 退避重连 */
      } finally {
        if (!closed) {
          const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
          attempt += 1;
          timer = window.setTimeout(() => void connect(), wait);
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer !== null) window.clearTimeout(timer);
        attempt = 0;
        void connect();
      } else {
        controller?.abort();
      }
    };

    void connect();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [character, enabled]);
}
