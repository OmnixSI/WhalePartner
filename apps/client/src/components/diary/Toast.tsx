/**
 * 便签小提示（规范 §7.2.5「写好 toast」/ §7.3.5「已经忘掉了。+ 撤回」）。
 *
 * 全站没有挂 Toaster（不引第三方），所以这里就一张贴纸样的便签：`role="status"`，
 * 固定底部居中，最多一个操作（撤回），到时间自己收起来；calm/老人模式下不做位移。
 */
import { useEffect, useRef } from "react";
import { InkFrame } from "../ink";

type Props = {
  open: boolean;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
  /** 0 = 不自动关（由外部控制）。 */
  duration?: number;
  tone?: "plain" | "alert";
};

export function Toast({ open, text, actionLabel, onAction, onClose, duration = 4000, tone = "plain" }: Props) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || duration <= 0) return;
    const timer = window.setTimeout(() => closeRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration, text]);

  if (!open) return null;

  return (
    <div className="toast" data-tone={tone} role="status" aria-live="polite">
      <InkFrame radius={14} stroke={2} tone={tone === "alert" ? "alert" : "ink"} fill="sheet" className="toast__panel">
        <span className="toast__text">{text}</span>
        {actionLabel && onAction && (
          <button type="button" className="btn btn--quiet toast__action" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </InkFrame>
    </div>
  );
}
