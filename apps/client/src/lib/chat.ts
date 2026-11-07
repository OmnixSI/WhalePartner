import { API_BASE } from "./api";
import { classifyHttp, classifyStreamError, ChatError } from "./chat-errors";
import type { AvatarEmotion } from "../avatar/model.config";

export interface HistoryMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  emotion: string | null;
  createdAt: string;
  sessionId: string;
  /** 附件：被打断的回复是 `{type:"interrupted"}`；她逛到的明信片是 `{type:"surf",…}`。 */
  attachment?: { type?: string } | null;
}

export interface ChatSession {
  id: string;
  character: string;
  title: string;
  titleManual?: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "video"; stage: "reading" | "watching" | "thinking" | "failed"; message: string; title?: string }
  | { type: "web"; stage: "reading" | "summarizing" | "failed"; message: string; title?: string }
  | { type: "emotion"; emotion: AvatarEmotion }
  | { type: "done"; messageId: number; sessionId: string; emotion: AvatarEmotion; provider?: string }
  | { type: "ack"; clientId?: string; sessionId: string; queued?: boolean; duplicate?: boolean }
  | { type: "ping" }
  | { type: "error"; message: string; code?: string };

/** 解析 SSE：每个事件形如 `event: name\ndata: {json}`。 */
export function parseSseBlock(block: string): ChatStreamEvent | null {
  let name = "";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!name || data.length === 0) return null;
  try {
    return { type: name, ...JSON.parse(data.join("\n")) } as ChatStreamEvent;
  } catch {
    return null;
  }
}

/** 客户端为每条消息生成的幂等 id（服务端据此去重）。 */
export function newClientId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `c-${random}`.slice(0, 64);
}

export async function* streamChat(message: string, character: string, sessionId: string, signal?: AbortSignal, clientId?: string): AsyncGenerator<ChatStreamEvent> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, character, sessionId: sessionId || undefined, clientId }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ChatError("network", "网络好像断了，这句话没送出去。网络回来后点「再试一次」。");
  }
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw classifyHttp(response.status, body);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ChatError("network", "网络中途断了，她的话没有收全。网络回来后点「再试一次」。");
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match) break;
      const event = parseSseBlock(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
      if (!event) continue;
      if (event.type === "error") throw classifyStreamError(event.message, event.code);
      if (event.type === "done") finished = true;
      yield event;
    }
  }
  // 流在 done 之前就结束 = 断线，不能当成功。
  if (!finished && !signal?.aborted) throw new ChatError("network", "网络中途断了，她的话没有收全。网络回来后点「再试一次」。");
}

export async function fetchHistory(character: string, limit = 50, signal?: AbortSignal, sessionId?: string, aroundId?: number): Promise<HistoryMessage[]> {
  try {
    const query = new URLSearchParams({ limit: String(limit), character });
    if (sessionId) query.set("sessionId", sessionId);
    if (aroundId) query.set("aroundId", String(aroundId));
    const response = await fetch(`${API_BASE}/api/chat/history?${query}`, { signal });
    if (!response.ok) return [];
    return ((await response.json()) as { messages: HistoryMessage[] }).messages;
  } catch {
    return [];
  }
}

export async function fetchSessions(character: string, signal?: AbortSignal): Promise<ChatSession[]> {
  const response = await fetch(`${API_BASE}/api/chat/sessions?character=${encodeURIComponent(character)}`, { signal });
  if (!response.ok) throw new Error(`读取聊天记录失败（HTTP ${response.status}）。`);
  return ((await response.json()) as { sessions: ChatSession[] }).sessions;
}

export async function createChatSession(character: string): Promise<ChatSession> {
  const response = await fetch(`${API_BASE}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ character }),
  });
  if (!response.ok) throw new Error(`新建聊天失败（HTTP ${response.status}）。`);
  return ((await response.json()) as { session: ChatSession }).session;
}

export async function renameChatSession(id: string, character: string, title: string): Promise<ChatSession> {
  const response = await fetch(`${API_BASE}/api/chat/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ character, title }),
  });
  if (!response.ok) throw new Error(`重命名失败（HTTP ${response.status}）。`);
  return ((await response.json()) as { session: ChatSession }).session;
}

export async function deleteChatSession(id: string, character: string): Promise<{ ok: boolean; memoriesCleared: boolean }> {
  const response = await fetch(`${API_BASE}/api/chat/sessions/${encodeURIComponent(id)}?character=${encodeURIComponent(character)}`, { method: "DELETE" });
  if (!response.ok) {
    let message = `删除对话失败（HTTP ${response.status}）。`;
    try { message = ((await response.json()) as { error?: string }).error ?? message; } catch { /* 非 JSON */ }
    throw new Error(message);
  }
  return (await response.json()) as { ok: boolean; memoriesCleared: boolean };
}

export async function clearHistory(): Promise<{ ok: boolean; memoriesCleared: boolean }> {
  try {
    const response = await fetch(`${API_BASE}/api/chat/history`, { method: "DELETE" });
    if (!response.ok) return { ok: false, memoriesCleared: false };
    const result = (await response.json()) as { memoriesCleared?: boolean };
    window.dispatchEvent(new Event("whalepartner:history-cleared"));
    return { ok: true, memoriesCleared: result.memoriesCleared !== false };
  } catch {
    return { ok: false, memoriesCleared: false };
  }
}
