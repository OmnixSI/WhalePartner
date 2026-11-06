/**
 * 水彩平涂的浪（规范 §5.5）。
 *
 * 三层浪 + 一条「浪线」，宽度 2880（= 两个 1440），位移 -50% 时无缝循环；
 * 只用 transform 漂移（线性无限），`will-change: transform`，不碰布局。
 *
 * - `variant="stage"`：聊天页舞台底部，28%（手机 22%），涨上来（spring 170/18）；
 * - `variant="sill"`：其他页的「潮线」，72px，只画 mid + near 并且不动。
 *   页面同时要给内容 `padding-bottom: 96px`（手机 88px），潮线不得压住正文。
 * - 水彩晕边：只给 near 层一个**静态**滤镜（feTurbulence + feDisplacementMap）；
 *   手机 / 老人 / calm 下不加滤镜，用平涂。
 * - 暗色（深海夜）再叠 5 颗平涂四角星与一弯平涂月，无光晕、不闪烁。
 * 整组 aria-hidden：浪是装饰。
 */
import { motion } from "motion/react";
import { useId } from "react";
import { fourPointStarPath, rng, waveCrestPath, wavePath } from "../../lib/ink";
import { useInkEnv } from "./useCalm";
import "../../styles/ink.css";

type Props = {
  variant?: "stage" | "sill";
  className?: string;
};

type LayerGeom = { seed: number; base: number; amp: [number, number]; len: [number, number] };

/** 三层参数照抄规范的表：len 必须整除 1440。 */
const WAVES: Record<"far" | "mid" | "near", LayerGeom> = {
  far: { seed: 11, base: 0.45, amp: [10, 4], len: [720, 360] },
  mid: { seed: 23, base: 0.55, amp: [14, 6], len: [480, 240] },
  near: { seed: 37, base: 0.68, amp: [18, 8], len: [360, 180] },
};

/** 5 颗星：种子 5，固定位置，不闪烁。 */
const STARS = (() => {
  const r = rng(5);
  return Array.from({ length: 5 }, () => {
    const cx = 120 + r() * 1200;
    const cy = 18 + r() * 54;
    const rad = 3 + r() * 2; // 边长 6–10
    return { cx, cy, d: fourPointStarPath(cx, cy, rad) };
  });
})();

const MOON = { cx: 1258, cy: 46, r: 14 };

function Sky({ uid }: { uid: string }) {
  return (
    <svg className="tide__sky" viewBox="0 0 1440 200" preserveAspectRatio="none" aria-hidden focusable="false">
      <defs>
        <mask id={`${uid}-moon`} maskUnits="userSpaceOnUse" x={MOON.cx - 24} y={MOON.cy - 24} width={48} height={48}>
          <circle cx={MOON.cx} cy={MOON.cy} r={MOON.r} fill="white" />
          <circle cx={MOON.cx + 6} cy={MOON.cy - 4} r={MOON.r - 1} fill="black" />
        </mask>
      </defs>
      {STARS.map((s, i) => (
        <path key={i} d={s.d} fill="var(--lamp)" />
      ))}
      <circle cx={MOON.cx} cy={MOON.cy} r={MOON.r} fill="var(--lamp)" opacity={0.8} mask={`url(#${uid}-moon)`} />
    </svg>
  );
}

export function Tide({ variant = "stage", className = "" }: Props) {
  const { calm, dark, narrow } = useInkEnv();
  const uid = `tide${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // 老人模式在 a11y.ts 里已经写成 data-motion="calm"，所以这里不用再判 elder。
  const wash = !calm && !narrow;
  const keys = variant === "sill" ? (["mid", "near"] as const) : (["far", "mid", "near"] as const);

  return (
    <motion.div
      className={`tide tide--${variant} ${className}`.trim()}
      aria-hidden
      initial={calm ? false : { y: 14 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 170, damping: 18 }}
    >
      {dark && variant === "stage" && <Sky uid={uid} />}
      {keys.map((key) => {
        const g = WAVES[key];
        const geom = { base: g.base, amp: g.amp, len: g.len };
        const washed = key === "near" && wash;
        return (
          <div key={key} className={`tide__layer tide__layer--${key}`}>
            <svg viewBox="0 0 2880 200" preserveAspectRatio="none" aria-hidden focusable="false">
              {washed && (
                <defs>
                  <filter id={`${uid}-wash`} x="-4%" y="-12%" width="108%" height="124%">
                    <feTurbulence type="fractalNoise" baseFrequency=".02 .06" numOctaves="2" seed="3" result="turb" />
                    <feDisplacementMap in="SourceGraphic" in2="turb" scale="6" xChannelSelector="R" yChannelSelector="G" />
                  </filter>
                </defs>
              )}
              <g filter={washed ? `url(#${uid}-wash)` : undefined}>
                <path d={wavePath(g.seed, geom)} fill={`var(--sea-${key === "far" ? 1 : key === "mid" ? 2 : 3})`} />
                {key === "near" && <path d={waveCrestPath(g.seed, geom)} fill="var(--sheet)" opacity={0.8} />}
              </g>
            </svg>
          </div>
        );
      })}
    </motion.div>
  );
}
