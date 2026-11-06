/**
 * 手绘水平线（规范 §5.2）。替代 `border-top: 1px solid var(--line)`：
 * 分隔线、导航当前项下划线、标题下划线、日记日期分隔、「她在想」指示线。
 *
 * 路径来自 `lib/ink.ts` 的模块级缓存：同一 (variant, seed, size) 永远是同一条抖动，
 * 所以截图可复现，滚动时也不重算。颜色一律继承 `color`（由调用方的 token 决定）。
 */
import { INK_LINE_BOX, hashSeed, inkLinePath, type InkLineVariant } from "../../lib/ink";
import "../../styles/ink.css";

type Props = {
  variant?: InkLineVariant; // divider 600×12 / underline 600×12（更粗）/ squiggle 600×16（波浪）
  seed?: number; // 默认由 id/variant 哈希；同一位置必须稳定
  size?: number; // 笔宽（viewBox 单位），divider 2.4 / underline 3.6
  draw?: "none" | "once" | "loop"; // once：进入时 520ms 自左向右画出；loop：思考指示 1800ms
  className?: string;
  /** 同页同一个 seed 不要用超过 2 次；给每一处一个稳定的 id，默认 seed 就从它算出来。 */
  id?: string;
};

export function InkLine({ variant = "divider", seed, size, draw = "none", className = "", id }: Props) {
  const box = INK_LINE_BOX[variant];
  const s = seed ?? hashSeed(id ?? `ink-line:${variant}`);
  const stroke = size ?? (variant === "underline" ? 3.6 : 2.4);
  return (
    <svg
      className={`ink-line ink-line--${variant} ink-line--${draw} ${className}`.trim()}
      viewBox={`0 0 ${box.w} ${box.h}`}
      preserveAspectRatio="none"
      height={box.h}
      aria-hidden
      focusable="false"
    >
      <path d={inkLinePath(s, stroke, variant)} fill="currentColor" />
    </svg>
  );
}
