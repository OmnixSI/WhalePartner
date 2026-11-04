import { useSyncExternalStore } from "react";

export type AvatarStatus = "loading" | "ready" | "failed";

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let status: AvatarStatus = "loading";
export function setAvatarStatus(next: AvatarStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((listener) => listener());
}
export const useAvatarStatus = () => useSyncExternalStore(subscribe, () => status);
