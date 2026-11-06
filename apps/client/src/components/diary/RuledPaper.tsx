/**
 * 横线本（规范 §7.2.2）：正文区每 36px 一条淡线，线在 35px 处，色 `color-mix(ink 9%, transparent)`。
 *
 * 不用 CSS gradient（规范禁止 gradient），也不用 data-URI 背景（那里拿不到 token 的颜色）：
 * 这里量出容器高度，逐行画 `<path>`，线跟着 `currentColor` 走，所以亮/暗、平涂/高对比都对。
 * 行高取 `--fs-diary × --lh-diary`，字号缩放（老人模式 / --scale）时线与字一起变，永远对得齐。
 */
import { useLayoutEffect, useRef, useState } from "react";

type Props = { className?: string };

export function RuledPaper({ className = "" }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ h: 0, step: 36 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const rect = el.getBoundingClientRect();
      const styles = getComputedStyle(el);
      const step = parseFloat(styles.lineHeight);
      setBox((prev) => {
        const next = { h: Math.round(rect.height), step: Number.isFinite(step) && step > 8 ? step : 36 };
        return prev.h === next.h && prev.step === next.step ? prev : next;
      });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { h, step } = box;
  const count = Math.min(Math.floor(h / step), 80);
  const lines = Array.from({ length: count }, (_, i) => {
    const y = (i + 1) * step - 3;
    const wobble = Math.sin(i * 1.7) * 0.7;
    return `M0 ${(y + wobble).toFixed(1)} C ${(54 + i % 5).toFixed(0)} ${(y - wobble).toFixed(1)}, ${(112 + i % 7).toFixed(0)} ${(y + wobble).toFixed(1)}, 200 ${(y + wobble * 0.6).toFixed(1)}`;
  });

  return (
    <div ref={ref} className={`ruled ${className}`.trim()} aria-hidden>
      {count > 0 && (
        <svg className="ruled__ink" viewBox={`0 0 200 ${h || 1}`} preserveAspectRatio="none" height={h || 1} focusable="false">
          {lines.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}
    </div>
  );
}
