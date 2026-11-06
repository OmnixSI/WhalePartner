/**
 * 邮戳 / 标签（规范 §5.4）。
 *
 * **文字与图形绝不重叠**：
 * - `postmark` / `done`：手绘外圈 + 一圈细内圈，中间两行用 flex 居中；圆直径由**量出来的文字块**
 *   反推（内切约束 `2·√((w/2)²+(h/2)²) + 14`），所以再长的日期也不会压到环上；
 *   同时 `size` 仍是直径的下限，多一行再长 12px。
 * - `label` / `fail`：InkFrame 的小号版，单行、左右各 `--sp-3`，高 22px 起（「AI 角色」用它，永远可见）。
 * - 邮戳**不可点击**，不是按钮。
 * - `animate`：落下（spring 400/17，scale 1.3 → 1、rotate -14° → -6°、opacity 0 → .9），约 260ms，只播一次；
 *   老人模式 / calm 直接给完成态。
 */
import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { hashSeed, inkCirclePath } from "../../lib/ink";
import { InkFrame } from "./InkFrame";
import { useInkEnv } from "./useCalm";
import "../../styles/ink.css";

export type StampKind = "postmark" | "label" | "done" | "fail";

type Props = {
  kind: StampKind;
  /** postmark: ["鲸汐", "11.07"]；label: ["AI 角色"]；done: ["写好啦"]；fail: ["没送到"] */
  lines: string[];
  /** 直径的下限（postmark/done）；label/fail 是矩形，忽略此值 */
  size?: 72 | 96;
  tone?: "accent" | "alert"; // fail 强制 alert，其余默认 accent
  animate?: boolean; // 首次出现：落下
  className?: string;
  id?: string;
};

const SPRING = { type: "spring", stiffness: 400, damping: 17 } as const;
const NUMERIC = /^[\d\s.:：/·-]+$/;

/** 圆形邮戳：外圈手绘、内圈细 1px、中间文字由 flex 居中。 */
function Round({ size, seed, lines }: { size: number; seed: number; lines: string[] }) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [text, setText] = useState({ w: 0, h: 0 });
  const sig = lines.join("|");

  // 量文字块：文字不换行（nowrap），所以宽度不随圆直径变化，没有「量—改—再量」的回路。
  // 用 getBoundingClientRect 而不是 scrollWidth/scrollHeight——flex 布局下 scrollHeight 会少算行盒。
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.ceil(r.width);
      const h = Math.ceil(r.height);
      setText((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sig]);

  // 内切约束：文字块的四角必须落在内圈里。+24 = 内圈(6) + 外环笔宽(2.6×2) + 两圈之间的空隙。
  const fit = Math.ceil(2 * Math.hypot(text.w / 2, text.h / 2) + 24);
  const base = size + Math.max(0, lines.length - 1) * 12;
  const d = Math.max(base, text.w > 0 ? fit : 0);
  const r = d / 2 - 3;

  return (
    <span className="stamp__round" style={{ "--stamp-size": `${d}px` } as CSSProperties}>
      <svg className="stamp__ring" viewBox={`0 0 ${d} ${d}`} width={d} height={d} aria-hidden focusable="false">
        <circle cx={d / 2} cy={d / 2} r={r - 6} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.55} />
        <path d={inkCirclePath(seed, r, 2.6)} fill="currentColor" />
      </svg>
      <span className="stamp__lines" ref={textRef}>
        {lines.map((line, i) => (
          <span key={`${line}-${i}`} className={`stamp__line stamp__line--${NUMERIC.test(line) ? "num" : "voice"}`}>
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Stamp({ kind, lines, size = 72, tone, animate = false, className = "", id }: Props) {
  const env = useInkEnv();
  const alert = kind === "fail" || tone === "alert";
  const round = kind === "postmark" || kind === "done";
  const seed = hashSeed(id ?? `stamp:${kind}:${lines.join("|")}`);
  const tilt = round ? -6 : 0;
  const cls = `stamp stamp--${kind} ${alert ? "stamp--alert" : "stamp--accent"} ${className}`.trim();

  const inner = round ? (
    <Round size={size} seed={seed} lines={lines} />
  ) : (
    <span className="stamp__rect">
      <InkFrame as="div" radius={4} stroke={1.6} tone={alert ? "alert" : "accent"} openCorner seed={seed}>
        <span className="stamp__label">{lines.join(" ")}</span>
      </InkFrame>
    </span>
  );

  // 落下动画只给圆形邮戳（标签是常驻的小 chip，不该每次出现都转一下）。
  if (animate && !env.calm) {
    return (
      <motion.div
        className={cls}
        initial={{ scale: 1.3, rotate: round ? -14 : 0, opacity: 0 }}
        animate={{ scale: 1, rotate: tilt }}
        transition={SPRING}
      >
        {inner}
      </motion.div>
    );
  }
  return (
    <div className={cls} style={{ transform: `rotate(${tilt}deg)` }}>
      {inner}
    </div>
  );
}
