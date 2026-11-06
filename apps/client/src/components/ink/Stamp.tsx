/**
 * 邮戳 / 标签（规范 §5.4）。
 *
 * - `postmark`、`done`：手绘圆圈（perfect-freehand 画的外圈，缺口 12°）+ 一圈细内圈 + 中间文字；
 * - `label`、`fail`：InkFrame 的小号版，13px 界面字、字距 .06em（「AI 角色」就用它，永远可见）；
 * - 邮戳**不可点击**，不是按钮，所以这里只有 div/span，没有 role/tabIndex。
 * - `animate`：落下（spring 400/17，scale 1.3 → 1、rotate -14° → -6°、opacity 0 → .9），约 260ms，
 *   只播一次；老人模式 / calm 直接给完成态。
 */
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { hashSeed, inkCirclePath } from "../../lib/ink";
import { InkFrame } from "./InkFrame";
import { useInkEnv } from "./useCalm";
import "../../styles/ink.css";

export type StampKind = "postmark" | "label" | "done" | "fail";

type Props = {
  kind: StampKind;
  /** postmark: ["鲸汐", "11.07"]；label: ["AI 角色"]；done: ["写好啦"]；fail: ["没送到"] */
  lines: string[];
  size?: 72 | 96; // postmark/done 的直径；label/fail 是矩形，高 22px，忽略此值
  tone?: "accent" | "alert"; // fail 强制 alert，其余默认 accent
  animate?: boolean; // 首次出现：落下
  className?: string;
  id?: string;
};

const SPRING = { type: "spring", stiffness: 400, damping: 17 } as const;
const NUMERIC = /^[\d\s.:：/·-]+$/;

/** 圆形邮戳：外圈手绘、内圈细 1px、中间文字。文字用 HTML 叠在 SVG 上，字体才走 token。 */
function Round({ size, seed, lines }: { size: number; seed: number; lines: string[] }) {
  const r = size / 2 - 3;
  return (
    <span className="stamp__round" style={{ "--stamp-size": `${size}px` } as CSSProperties}>
      <svg className="stamp__ring" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden focusable="false">
        <circle cx={size / 2} cy={size / 2} r={r - 5} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.55} />
        <path d={inkCirclePath(seed, r, 2.6)} fill="currentColor" />
      </svg>
      <span className="stamp__lines">
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

  // 落下动画只给圆形邮戳（标签是常驻的小chip，不该每次出现都转一下）。
  if (animate && !env.calm) {
    return (
      <motion.div
        className={cls}
        initial={{ scale: 1.3, rotate: round ? -14 : 0, opacity: 0 }}
        animate={{ scale: 1, rotate: tilt, opacity: 0.9 }}
        transition={SPRING}
      >
        {inner}
      </motion.div>
    );
  }
  return (
    <div className={cls} style={{ transform: `rotate(${tilt}deg)`, opacity: 0.9 }}>
      {inner}
    </div>
  );
}
