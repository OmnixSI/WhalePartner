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
    case "network": return "网络好像断了，这句话没送出去。网络回来后点「再试一次」。";
    case "quota": return raw?.trim() || "这个月的贝壳用完了，下个月 1 号再来找我。";
    case "timeout": return raw?.trim() || "她想了太久，几条线路都没回音。再试一次吧。";
    case "starting": return "她还在赶过来，稍等一下再发。";
    case "auth": return "这台设备还没连上你的鲸汐（或已被撤销）。到「设置 › 连接到我的鲸汐」重新配对。";
    case "busy": return "她还在回上一句，稍等一下。";
    case "empty": return "她这次什么都没说出来，再试一次吧。";
    case "model": return raw?.trim() ? `她那边出了点问题：${raw.trim()}` : "她那边出了点问题，再试一次吧。";
    default: return raw?.trim() || "这句话没送出去，再试一次吧。";
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
