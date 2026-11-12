/**
 * 你的话 = 一张平的小纸条（规范 §6.8 Slip）。
 * 底 `--slip`，字 16 / 1.7，右对齐，不旋转、不贴胶带；飞出去的那一张（float）从回信条弹到对话框右上方。
 * sending 在底边写一行「寄出中」，不降低不透明度；
 * failed 换 `--alert-wash` 底 + 一行「没送到」，下面「再发一次 / 删掉」。
 */
import { Button } from "../ui/Button";

type SlipStatus = "sending" | "sent" | "failed";

type Props = {
  id: string;
  text: string;
  status?: SlipStatus;
  /** 飞出去的那一张：带入场弹簧。 */
  float?: boolean;
  time?: string;
  onRetry?: () => void;
  onDiscard?: () => void;
  className?: string;
};

export function Slip({ text, status = "sent", float = false, time, onRetry, onDiscard, className = "" }: Props) {
  return (
    <div className={`slip slip--${status}${float ? " slip--float" : ""} ${className}`.trim()}>
      <p className="slip__text">{text}</p>
      {status === "sending" && <span className="slip__state" aria-live="polite">寄出中…</span>}
      {status === "failed" && <span className="slip__state" role="alert">没送到</span>}
      {time && !float && <time className="slip__time">{time}</time>}
      {status === "failed" && (onRetry || onDiscard) && (
        <span className="slip__actions">
          <Button onClick={onRetry}>再发一次</Button>
          <Button variant="ghost" onClick={onDiscard}>删掉</Button>
        </span>
      )}
    </div>
  );
}
