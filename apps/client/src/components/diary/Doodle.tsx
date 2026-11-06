/**
 * 涂鸦（规范 §7.2.4 / §6.10）：56×56，单色 `--ink-mute`，`InkLine` 的手感。
 *
 * 规范把图放在 `public/doodles/`；P2 的写入范围不含 `public/`，所以这里直接内联同一套笔迹：
 * 好处是跟着 `currentColor` 走（暗色/高对比自动适配），也不用再压一个请求。
 * 图形的 `aria-label` 由调用方给（「今天心里的天气：晴」），这里恒为 `aria-hidden`。
 */
import type { ReactElement } from "react";
import type { DoodleName } from "./types";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Sun() {
  return (
    <>
      <circle cx="28" cy="28" r="8.4" {...STROKE} strokeDasharray="30 3" transform="rotate(-12 28 28)" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
        const a = (deg * Math.PI) / 180;
        const inner = 14 + (i % 2) * 0.8;
        const outer = 19.5 + (i % 3) * 0.6;
        return (
          <path
            key={deg}
            d={`M${28 + Math.cos(a) * inner} ${28 + Math.sin(a) * inner} L${28 + Math.cos(a) * outer} ${28 + Math.sin(a) * outer}`}
            {...STROKE}
          />
        );
      })}
    </>
  );
}

function Cloud() {
  return (
    <>
      <path d="M14 32.5c-3.6-1.2-5-6.4-1.6-8.8 2.4-1.7 5.3-1 6.6.8 0-4.9 4.4-8.4 9.1-7.2 3.5.9 5.6 3.9 5.5 7 3.2-.6 6.6 1.5 6.6 5.1 0 3.3-2.6 5.6-6 5.6H18.4" {...STROKE} />
      <path d="M20 38.5c3.4.7 12.9.6 17.2 0" {...STROKE} strokeWidth={1.6} strokeDasharray="2 3.4" />
    </>
  );
}

function Rain() {
  return (
    <>
      <path d="M15.5 27.5c-3.4-1.4-4.4-6.3-.8-8.4 2.3-1.4 5-.7 6.2 1.1.4-4.6 4.6-7.6 9-6.4 3.3 1 5.2 3.9 5 6.9 3-.6 6.1 1.4 6.1 4.8 0 3-2.4 5-5.6 5H19.9" {...STROKE} />
      {[18, 27, 36].map((x, i) => (
        <path key={x} d={`M${x} ${34 + i} l-2.2 6`} {...STROKE} strokeWidth={2} />
      ))}
    </>
  );
}

function Moon() {
  return (
    <>
      <path d="M33.6 12.6c-7.6 1.6-12.4 9.3-10.2 16.6 2 6.6 8.6 10.6 15.1 9.2-4.2 3.5-10.3 4.4-15.6 1.7-7.4-3.8-10-13-5.6-19.7 3.5-5.4 10-8 16.3-7.8Z" {...STROKE} />
      <path d="M41 16.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9Z" {...STROKE} strokeWidth={1.7} />
    </>
  );
}

function Wave() {
  return (
    <>
      <path d="M9 22c4-4.4 8.4-4.4 12 0 3.6 4.4 8 4.4 12 0 2.6-2.9 5.3-3.6 8-2.4" {...STROKE} />
      <path d="M9 30.5c4-4.4 8.4-4.4 12 0 3.6 4.4 8 4.4 12 0 2.6-2.9 5.3-3.6 8-2.4" {...STROKE} strokeWidth={1.8} />
      <path d="M9 39c4-4.4 8.4-4.4 12 0 3.6 4.4 8 4.4 12 0 2.6-2.9 5.3-3.6 8-2.4" {...STROKE} strokeWidth={1.4} strokeDasharray="3 3.2" />
    </>
  );
}

function Star() {
  return (
    <>
      <path d="M28 9.5c1.6 5.4 3.7 7.6 9 9.2-5.3 1.7-7.4 3.8-9 9.2-1.6-5.4-3.7-7.5-9-9.2 5.3-1.6 7.4-3.8 9-9.2Z" {...STROKE} />
      <path d="M40 29.5c.9 3.1 2.1 4.3 5.2 5.3-3.1 1-4.3 2.2-5.2 5.3-.9-3.1-2.1-4.3-5.2-5.3 3.1-1 4.3-2.2 5.2-5.3Z" {...STROKE} strokeWidth={1.7} />
      <path d="M18 33c.7 2.4 1.6 3.3 4 4-2.4.7-3.3 1.6-4 4-.7-2.4-1.6-3.3-4-4 2.4-.7 3.3-1.6 4-4Z" {...STROKE} strokeWidth={1.4} />
    </>
  );
}

const SHAPES: Record<DoodleName, () => ReactElement> = {
  sun: Sun,
  cloud: Cloud,
  rain: Rain,
  moon: Moon,
  wave: Wave,
  star: Star,
};

export function Doodle({ name, size = 56 }: { name: DoodleName; size?: number }) {
  const Shape = SHAPES[name];
  return (
    <svg className="doodle" viewBox="0 0 56 56" width={size} height={size} aria-hidden focusable="false">
      <Shape />
    </svg>
  );
}
