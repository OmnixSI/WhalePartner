/**
 * 吐司的队列（不带 Radix，谁都能 import 而不增加首屏体积）。画出来的是 Toast.tsx 里的 Toaster，
 * 它只在 App 根部挂一次（ToastHost）；任何地方调用 toast({ title: "已导出" }) 即可。
 *
 * onDismiss：这条吐司离开时（计时到点、点「关掉」、点操作按钮、被新吐司挤掉、切页被清空）恰好调用一次。
 * 带撤回的操作把「真正提交」放在这里：吐司还在，撤回就还作数；吐司一走，才提交。
 */
import type { ReactNode } from "react";

export type ToastTone = "neutral" | "success" | "warning" | "error";
export type ToastInput = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** 毫秒，默认 8000 */
  duration?: number;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
};
export type ToastItem = ToastInput & { id: number; open: boolean };

let items: ToastItem[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };
const set = (next: ToastItem[]) => { items = next; emit(); };

/** 把还开着的这些标成已离开，并各调一次 onDismiss（回调里再弹吐司不受影响）。 */
function close(list: ToastItem[]) {
  const ids = new Set(list.filter((t) => t.open).map((t) => t.id));
  if (!ids.size) return;
  set(items.map((t) => (ids.has(t.id) ? { ...t, open: false, onDismiss: undefined } : t)));
  for (const t of list) if (ids.has(t.id)) t.onDismiss?.();
}

export function toast(input: ToastInput) {
  const id = ++seq;
  const open = items.filter((t) => t.open);
  const dropped = open.slice(0, Math.max(0, open.length - 2)); // 最多同时 3 条，最老的先走
  set([...items.filter((t) => t.open), { ...input, id, open: true }]); // 已走的不再留着（没有退出动画时 Radix 不会通知我们）
  close(dropped);
  return id;
}
toast.dismiss = (id: number) => close(items.filter((t) => t.id === id));
/** 切页时清空：每条都走 onDismiss，等于「到点提交」。 */
toast.clear = () => close(items);
toast.remove = (id: number) => set(items.filter((t) => t.id !== id));

export const subscribeToasts = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
export const toastSnapshot = () => items;
