import { EventEmitter } from "node:events";

export type SurfEventName = "session" | "step" | "item" | "share";

export interface SurfSessionEvent {
  state: "start" | "end";
  sessionId: number;
  kinds: Array<"video" | "web">;
  count?: number;
}

export interface SurfStepEvent {
  sessionId: number;
  stage: "searching" | "watching" | "reading" | "writing";
  kind: "video" | "web" | null;
}

export interface SurfItemEvent {
  id: number;
  kind: "video" | "web";
  title: string;
  sourceSite: string;
  thumb: string | null;
  comment: string;
  createdAt: string;
}

export interface SurfShareEvent {
  itemId: number;
  messageId: number;
}

/**
 * 进程内事件总线（§10.6.7）：一次会话的进度广播给该角色的所有 SSE 连接。
 * 没有连接时 publish 不做事，不排队、不补发——SSE 只是「她在逛」的现场直播。
 */
export class SurfEventBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    this.#emitter.setMaxListeners(0);
  }

  publish(character: string, event: SurfEventName, data: unknown) {
    this.#emitter.emit(`surf:${character}`, event, data);
  }

  subscribe(character: string, listener: (event: SurfEventName, data: unknown) => void): () => void {
    const key = `surf:${character}`;
    const wrapped = (event: SurfEventName, data: unknown) => listener(event, data);
    this.#emitter.on(key, wrapped);
    return () => {
      this.#emitter.off(key, wrapped);
    };
  }

  listenerCount(character: string): number {
    return this.#emitter.listenerCount(`surf:${character}`);
  }
}
