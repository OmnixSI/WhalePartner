/**
 * 设置页的小便签提示（规范 §9.1「Toast 8 秒且有『关掉』按钮」）。
 * 全站没有装 Toaster，这里自己画一张固定底部居中的纸条：`role="status"`，不抢焦点。
 */
import { useEffect } from "react";

type Props = {
  text: string | null;
  onClose: () => void;
  /** 老人模式给足 8 秒（规范 §9.1） */
  duration?: number;
};

export function Toast({ text, onClose, duration = 8000 }: Props) {
  useEffect(() => {
    if (!text) return;
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [text, duration, onClose]);

  if (!text) return null;

  return (
    <div className="set-toast" role="status" aria-live="polite">
      <p className="set-toast__text">{text}</p>
      <button type="button" className="btn btn--quiet set-toast__close" onClick={onClose}>
        关掉
      </button>
    </div>
  );
}
