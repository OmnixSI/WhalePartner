import { useSyncExternalStore } from "react";

export type AvatarStatus = "loading" | "ready" | "failed";

let status: AvatarStatus = "loading";
const listeners = new Set<() => void>();

export function setAvatarStatus(next: AvatarStatus) {
  if (status === next) return;
  status = next;
  listeners.forEach((listener) => listener());
}

export function useAvatarStatus() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}
