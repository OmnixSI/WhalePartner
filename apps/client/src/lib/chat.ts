import { API_BASE } from "./api";
import type { AvatarEmotion } from "../avatar/model.config";

export interface HistoryMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  emotion: string | null;
  createdAt: string;
  sessionId: string;
}

export interface ChatSession {
  id: string;
  character: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "video"; stage: "reading" | "watching" | "thinking" | "failed"; message: string; title?: string }
  | { type: "web"; stage: "reading" | "summarizing" | "failed"; message: string; title?: string }
  | { type: "recall"; memories: string[] }
  | { type: "emotion"; emotion: AvatarEmotion }
  | { type: "done"; messageId: number; sessionId: string; emotion: AvatarEmotion; provider?: string }
  | { type: "error"; message: string };

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

export async function* streamChat(message: string, character: string, sessionId: string, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, character, sessionId }),
    signal,
  });
  if (!response.ok || !response.body) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try { detail = ((await response.json()) as { error?: string }).error ?? detail; } catch { /* 非 JSON */ }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match) break;
      const event = parseSseBlock(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
      if (event) yield event;
    }
  }
}

export async function fetchHistory(character: string, limit = 50, signal?: AbortSignal, sessionId?: string): Promise<HistoryMessage[]> {
  try {
    const query = new URLSearchParams({ limit: String(limit), character });
    if (sessionId) query.set("sessionId", sessionId);
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
