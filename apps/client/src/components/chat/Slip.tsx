/**
 * 你的话 = 手写便签（规范 §6.8 Slip）。
 * 底 `--slip`，字 16 / 1.7，内边距 10 14，上左/上右 `--r-md`、下右 `--r-xs`，右对齐；
 * 旋转取 [-0.8,-0.4,0.4,0.8][hash(id)%4]（老人 / calm 归零，交给 chat.css）；
 * 飞出去的那一张（float）顶角贴一条 Tape，从回信条位置弹到对话框右上方。
 * sending 只在底边画一条会自己画的墨线 + 13px「寄出中」，不降低不透明度；
 * failed 换 `--alert-wash` 底 + Stamp fail，下面「再发一次 / 删掉」。
 */
import { hashSeed } from "../../lib/ink";
import { InkLine, Stamp, Tape } from "../ink";
import { useInkEnv } from "../ink/useCalm";

type SlipStatus = "sending" | "sent" | "failed";

type Props = {
  id: string;
  text: string;
  status?: SlipStatus;
  /** 飞出去的那一张：贴胶带、带入场弹簧。 */
  float?: boolean;
  tape?: boolean;
  time?: string;
  onRetry?: () => void;
  onDiscard?: () => void;
  className?: string;
};

const ROT = ["a", "b", "c", "d"] as const;

export function Slip({ id, text, status = "sent", float = false, tape = false, time, onRetry, onDiscard, className = "" }: Props) {
  const calm = useInkEnv().calm;
  const rot = float || calm ? "a" : ROT[hashSeed(id) % ROT.length];

  return (
    <div className={`slip slip--${status}${float ? " slip--float" : ""} ${className}`.trim()} data-rot={rot}>
      {tape && <Tape color="c" angle={-4} w={28} h={12} className="slip__tape" />}
      <p className="slip__text">{text}</p>
      {status === "sending" && (
        <span className="slip__state" aria-live="polite">
          <InkLine id={`slip-${id}`} size={2.4} draw={calm ? "none" : "loop"} className="slip__ink" />
          寄出中
        </span>
      )}
      {status === "failed" && (
        <span className="slip__fail">
          <Stamp kind="fail" lines={["没送到"]} />
        </span>
      )}
      {time && !float && <time className="slip__time">{time}</time>}
      {status === "failed" && (onRetry || onDiscard) && (
        <span className="slip__actions">
          <button type="button" className="btn btn--secondary" onClick={onRetry}>
            再发一次
          </button>
          <button type="button" className="btn btn--quiet" onClick={onDiscard}>
            删掉
          </button>
        </span>
      )}
    </div>
  );
}
