import { useSyncExternalStore } from "react";
import { AVATAR_MODELS, DEFAULT_MODEL_ID, type AvatarModel } from "./model.config";

export type AvatarStatus = "loading" | "ready" | "failed";

const STORAGE_KEY = "wp.avatar";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let status: AvatarStatus = "loading";
export function setAvatarStatus(next: AvatarStatus) {
  if (status === next) return;
  status = next;
  notify();
}
export const useAvatarStatus = () => useSyncExternalStore(subscribe, () => status);

function readModelId() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && AVATAR_MODELS.some((m) => m.id === saved)) return saved;
  } catch { /* 隐私模式下 localStorage 可能不可用 */ }
  return DEFAULT_MODEL_ID;
}

let modelId = readModelId();
export function setAvatarModel(id: string) {
  if (id === modelId || !AVATAR_MODELS.some((m) => m.id === id)) return;
  modelId = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* 忽略 */ }
  notify();
}
export function useAvatarModel(): AvatarModel {
  const id = useSyncExternalStore(subscribe, () => modelId);
  return AVATAR_MODELS.find((m) => m.id === id) ?? AVATAR_MODELS[0];
}
