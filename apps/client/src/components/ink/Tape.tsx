/**
 * 胶带（规范 §5.4）。纯 CSS 的一块，斜纹是 SVG 描边（不是 gradient），
 * 四条边用 clip-path 撕成不齐的锯齿，圆角只取 --r-xs。
 *
 * 用法：放在卡片顶边，`top: -10px; left: 16–28px`；同屏 ≤4 条，胶带不遮挡文字。
 * 老人模式角度归零、只留 ≤2 条（由使用方裁剪数量，CSS 负责把角度压平）。
 */
import type { CSSProperties } from "react";
import "../../styles/ink.css";

type Props = {
  color?: "a" | "b" | "c" | "d";
  /** -6..6 度；超出会被夹住，胶带永远是「贴歪一点」，不是随便转 */
  angle?: number;
  w?: number;
  h?: number;
  className?: string;
};

export function Tape({ color = "a", angle = -3, w = 72, h = 22, className = "" }: Props) {
  const deg = Math.max(-6, Math.min(6, angle));
  const style = {
    "--w": `${w}px`,
    "--h": `${h}px`,
    "--angle": `${deg}deg`,
    "--tape": `var(--tape-${color})`,
  } as CSSProperties;
  return <span className={`tape ${className}`.trim()} style={style} aria-hidden />;
}
