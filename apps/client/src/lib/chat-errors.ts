import { m } from "../i18n/index.ts";
/** 把各种失败翻译成一句人话（纯函数，可单测）。 */

export type ChatErrorCode = "network" | "quota" | "timeout" | "starting" | "auth" | "busy" | "empty" | "model" | "http";

export class ChatError extends Error {
  readonly code: ChatErrorCode;
  constructor(code: ChatErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function describeChatFailure(code: ChatErrorCode, raw?: string): string {
  switch (code) {
    case "network": return m.common.chatErrors.network;
    case "quota": return raw?.trim() || m.common.chatErrors.quota;
    case "timeout": return raw?.trim() || m.common.chatErrors.timeout;
    case "starting": return m.common.chatErrors.starting;
    case "auth": return m.common.chatErrors.auth;
    case "busy": return m.common.chatErrors.busy;
    case "empty": return m.common.chatErrors.empty;
    case "model": return raw?.trim() ? m.common.chatErrors.modelWith(raw.trim()) : m.common.chatErrors.model;
    default: return raw?.trim() || m.common.chatErrors.fallback;
  }
}

export function classifyHttp(status: number, body: { error?: string; message?: string; code?: string }): ChatError {
  if (status === 402 || body.error === "quota_exceeded") return new ChatError("quota", describeChatFailure("quota", body.message));
  if (status === 401) return new ChatError("auth", describeChatFailure("auth"));
  if (status === 409) return new ChatError("busy", describeChatFailure("busy", body.message));
  if (status === 502 || status === 503 || status === 504) return new ChatError("starting", describeChatFailure("starting"));
  return new ChatError("http", describeChatFailure("http", body.message ?? body.error));
}

export function classifyStreamError(message: string | undefined, code?: string): ChatError {
  if (code === "timeout") return new ChatError("timeout", describeChatFailure("timeout", message));
  if (code === "empty") return new ChatError("empty", describeChatFailure("empty"));
  return new ChatError("model", describeChatFailure("model", message));
}
