import { useSyncExternalStore } from "react";

export type AvatarStatus = "loading" | "ready" | "failed";

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let status: AvatarStatus = "loading";
let owner = 0;

/**
 * 每个舞台实例开始加载时 claim 一次，拿到自己的 token；
 * 之后只有最新 token 能写状态，旧实例迟到的 ready/failed 不会覆盖新实例。
 * 不带 token 的调用（例如聊天页点「再试一次」）始终生效。
 */
export function claimAvatar(): number {
  owner += 1;
  setAvatarStatus("loading", owner);
  return owner;
}

export function setAvatarStatus(next: AvatarStatus, token?: number) {
  if (token !== undefined && token !== owner) return;
  if (status === next) return;
  status = next;
  listeners.forEach((listener) => listener());
}
export const useAvatarStatus = () => useSyncExternalStore(subscribe, () => status);
