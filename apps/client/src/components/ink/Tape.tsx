/**
 * 胶带（规范 §5.4）。纯 CSS 的一块，斜纹是 SVG 描边（不是 gradient），
 * 四条边用 clip-path 撕成不齐的锯齿，圆角只取 --r-xs。
 *
 * 用法：放在卡片顶边，`top: -10px; left: 16–28px`；同屏 ≤4 条，胶带不遮挡文字。
 * 老人模式角度归零、只留 ≤2 条（由使用方裁剪数量，CSS 负责把角度压平）。
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  const ref = useRef<HTMLSpanElement | null>(null);
  const [flow, setFlow] = useState(true);

  // 胶带靠 absolute 贴在卡片上；如果父容器是普通静态容器（比如刚放进一个 flex 行里），
  // 就退化成流内元素，否则它会按「静态位置」飘出来、压到旁边的东西上。
  useEffect(() => {
    const parent = ref.current?.parentElement;
    setFlow(!parent || getComputedStyle(parent).position === "static");
  }, []);
  const style = {
    "--w": `${w}px`,
    "--h": `${h}px`,
    "--angle": `${deg}deg`,
    "--tape": `var(--tape-${color})`,
  } as CSSProperties;
  return <span ref={ref} className={`tape ${className}`.trim()} style={style} data-mode={flow ? "flow" : "stuck"} aria-hidden />;
}
