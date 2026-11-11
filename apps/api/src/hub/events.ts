/**
 * 「家」后端的实时事件总线。
 *
 * 一个用户 = 一个 hub，所有设备都连它。任何设备发的消息、她正在逐字写的回复、日记/记忆/见闻的变化，
 * 都从这里广播给所有连着 `GET /api/events` 的设备。内存环形缓冲保留最近 500 条，
 * 断线的设备带着 Last-Event-ID 回来时按序补齐；缓冲已经滚过头就发一条 `resync`，让客户端整体重拉。
 */
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { sendSse } from "../server/http.ts";

export const EVENT_TYPES = [
  "message.created",
  "message.delta",
  "message.done",
  "message.interrupted",
  "typing",
  "diary.updated",
  "memory.updated",
  "surf.item",
  "settings.updated",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface HubEvent {
  id: number;
  type: EventType;
  payload: unknown;
  at: string;
}

export const EVENT_BUFFER_SIZE = 500;

export class EventBus {
  readonly #emitter = new EventEmitter();
  readonly #buffer: HubEvent[] = [];
  #nextId = 1;
  readonly #size: number;

  constructor(size = EVENT_BUFFER_SIZE) {
    this.#size = size;
    this.#emitter.setMaxListeners(0);
  }

  publish(type: EventType, payload: unknown): HubEvent {
    const event: HubEvent = { id: this.#nextId++, type, payload, at: new Date().toISOString() };
    this.#buffer.push(event);
    if (this.#buffer.length > this.#size) this.#buffer.splice(0, this.#buffer.length - this.#size);
    this.#emitter.emit("event", event);
    return event;
  }

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.#emitter.on("event", listener);
    return () => { this.#emitter.off("event", listener); };
  }

  /** Last-Event-ID 之后的事件；`gap` 为真表示缓冲里已经没有那一段了（需要整体重拉）。 */
  since(lastId: number): { events: HubEvent[]; gap: boolean } {
    const oldest = this.#buffer[0]?.id;
    // 缓冲滚过头，或 hub 重启过（客户端手里的 id 比现在的还大）都要整体重拉。
    const gap = lastId > 0 && (lastId > this.lastId || (oldest === undefined ? lastId < this.lastId : lastId < oldest - 1));
    return { events: this.#buffer.filter((event) => event.id > lastId), gap };
  }

  get lastId(): number { return this.#nextId - 1; }
  get listenerCount(): number { return this.#emitter.listenerCount("event"); }
}

/** 进程级单例：其他模块直接 `publishEvent("diary.updated", {...})`。 */
export const hubEvents = new EventBus();

export function publishEvent(type: EventType, payload: unknown): HubEvent {
  return hubEvents.publish(type, payload);
}

function frame(event: HubEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify({ ...(event.payload as object), _at: event.at })}\n\n`;
}

/** 把 SSE 连接挂到总线上；返回清理函数。 */
export function attachEventStream(
  bus: EventBus,
  response: ServerResponse,
  lastEventId: number,
  heartbeatMs = Number(process.env.WP_EVENTS_HEARTBEAT_MS) || 15_000,
): () => void {
  const write = (text: string) => {
    if (response.writableEnded || response.destroyed) return;
    response.write(text);
  };
  write("retry: 2000\n\n");
  const backlog = bus.since(lastEventId);
  if (backlog.gap) sendSse(response, "resync", { reason: "buffer-overrun", lastId: bus.lastId });
  // hub 重启后 id 从 1 重新数：客户端手里的旧 id 更大，按它过滤会把重启后的新事件全丢掉。
  let replayedThrough = Math.min(lastEventId, bus.lastId);
  for (const event of backlog.events) {
    write(frame(event));
    replayedThrough = event.id;
  }
  const unsubscribe = bus.subscribe((event) => {
    if (event.id <= replayedThrough) return;
    write(frame(event));
  });
  const beat = setInterval(() => write(": ping\n\n"), heartbeatMs);
  beat.unref?.();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(beat);
    unsubscribe();
  };
  response.on("close", cleanup);
  response.on("error", cleanup);
  return cleanup;
}
