/** 聊天偏好（存 localStorage，改动即时广播）：发送键位、是否按句分条出现。 */
export type SendKey = "enter" | "mod-enter";

const SEND_KEY = "wp.sendKey";
const PACE_KEY = "wp.pace";
export const PREFS_EVENT = "wp:chat-prefs";

export function readSendKey(): SendKey {
  try { return localStorage.getItem(SEND_KEY) === "mod-enter" ? "mod-enter" : "enter"; } catch { return "enter"; }
}

export function writeSendKey(value: SendKey) {
  try { localStorage.setItem(SEND_KEY, value); } catch { /* 隐私模式 */ }
  window.dispatchEvent(new Event(PREFS_EVENT));
}

export function readPace(): boolean {
  try { return localStorage.getItem(PACE_KEY) !== "off"; } catch { return true; }
}

export function writePace(on: boolean) {
  try { localStorage.setItem(PACE_KEY, on ? "on" : "off"); } catch { /* 隐私模式 */ }
  window.dispatchEvent(new Event(PREFS_EVENT));
}

/** 当前这次按键算不算「发送」。触屏设备 Enter 永远是换行。 */
export function isSendKey(event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, sendKey: SendKey, coarse: boolean): boolean {
  if (event.key !== "Enter") return false;
  if (sendKey === "mod-enter" || coarse) return event.metaKey || event.ctrlKey;
  return !event.shiftKey;
}
