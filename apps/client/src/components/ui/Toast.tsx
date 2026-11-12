/**
 * 吐司（Radix Toast）：操作结果的轻提示，8 秒后自己消失，常显「关掉」按钮（沿用 settings/Toast 的约定）。
 * 只说结果和下一步，不要用它报需要处理的错误——那种放在出错的位置旁边。
 *
 *   App 根部放一次 <Toaster />；任何地方调用 toast({ title: "已导出" })。
 *   带撤销：toast({ title: "已删除", action: { label: "撤销", onClick: undo } })。
 *
 * 不常驻任何定时器：计时只在吐司显示时存在；窗口失焦时 Radix 会暂停计时。
 */
import { Toast as T } from "radix-ui";
import { useSyncExternalStore, type ReactNode } from "react";
import { cx } from "./cx";
import "./shared.css";
import "./Toast.css";

export type ToastTone = "neutral" | "success" | "warning" | "error";
export type ToastInput = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** 毫秒，默认 8000；有撤销操作时不短于 8000 */
  duration?: number;
  action?: { label: string; onClick: () => void };
};
type Item = ToastInput & { id: number; open: boolean };

let items: Item[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };
const set = (next: Item[]) => { items = next; emit(); };

export function toast(input: ToastInput) {
  const id = ++seq;
  set([...items.slice(-2), { ...input, id, open: true }]); // 最多同时 3 条
  return id;
}
toast.dismiss = (id: number) => set(items.map((t) => (t.id === id ? { ...t, open: false } : t)));

const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
const snapshot = () => items;

export function Toaster({ label = "通知" }: { label?: string }) {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <T.Provider duration={8000} swipeDirection="right" label={label}>
      {list.map((t) => (
        <T.Root
          key={t.id}
          open={t.open}
          duration={t.duration}
          onOpenChange={(o) => { if (!o) toast.dismiss(t.id); }}
          // 退出动画结束、Radix 卸载后再从列表里删
          onAnimationEnd={() => { if (!t.open) set(items.filter((x) => x.id !== t.id)); }}
          className={cx("ui-toast", t.tone && t.tone !== "neutral" && `ui-toast--${t.tone}`)}
        >
          <span className="ui-toast__mark" aria-hidden="true" />
          <div className="ui-toast__text">
            <T.Title className="ui-toast__title">{t.title}</T.Title>
            {t.description ? <T.Description className="ui-toast__desc">{t.description}</T.Description> : null}
          </div>
          {t.action ? (
            <T.Action altText={t.action.label} asChild>
              <button type="button" className="ui-toast__btn ui-toast__btn--action ui-press ui-focus" onClick={t.action.onClick}>{t.action.label}</button>
            </T.Action>
          ) : null}
          <T.Close asChild>
            <button type="button" className="ui-toast__btn ui-press ui-focus">关掉</button>
          </T.Close>
        </T.Root>
      ))}
      <T.Viewport className="ui-toast__viewport" />
    </T.Provider>
  );
}

/** 预览页用：静态画出一条吐司（不进 Provider、不计时） */
export function ToastPreview({ title, description, tone = "neutral", action }: ToastInput) {
  return (
    <div className={cx("ui-toast", tone !== "neutral" && `ui-toast--${tone}`)} data-state="static">
      <span className="ui-toast__mark" aria-hidden="true" />
      <div className="ui-toast__text">
        <p className="ui-toast__title">{title}</p>
        {description ? <p className="ui-toast__desc">{description}</p> : null}
      </div>
      {action ? <button type="button" className="ui-toast__btn ui-toast__btn--action ui-press ui-focus">{action.label}</button> : null}
      <button type="button" className="ui-toast__btn ui-press ui-focus">关掉</button>
    </div>
  );
}
