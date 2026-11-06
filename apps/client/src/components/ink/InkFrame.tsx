/**
 * 手绘圆角框（规范 §5.3）。SVG 只画线，底色由 CSS 背景给：
 * 对话框、卡片、便签、名字牌都用它，替代 `border + border-radius` 的机械感。
 *
 * 实现要点：
 * - `ResizeObserver` 量尺寸，**向上取整到 8 的倍数**再进缓存 key：拖窗口时不会每帧重算路径；
 * - 路径由 `lib/ink.ts` 的 `inkFramePath` 一次性算好并缓存（固定种子，截图稳定）；
 * - `openCorner` 在左上角留 ~6px 缺口，像一笔画完没接上。
 *
 * 性能上限：同屏手绘框 ≤12 个。列表超过 12 项时用 CSS 边框降级，只给选中/悬停的那张画手绘框。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hashSeed, inkFramePath, radiusToken } from "../../lib/ink";
import { useInkEnv } from "./useCalm";
import "../../styles/ink.css";

type Props = {
  as?: "div" | "section" | "article" | "li";
  radius?: number; // 默认 14（= --r-md）；对话框 20
  stroke?: number; // 默认 2（老人模式 3）
  tone?: "ink" | "accent" | "alert"; // 线色：ink-mute / accent / alert
  seed?: number;
  fill?: "sheet" | "paper-2" | "none"; // 底色由 CSS 背景提供，SVG 只画线
  openCorner?: boolean; // 左上角留 ~6px 缺口
  children: React.ReactNode;
  className?: string;
  /** 默认 seed 从它算，同一屏两处同 id 会得到同一条抖动 */
  id?: string;
};

/** 开发期护栏：同屏手绘框超过 12 个会提醒（规范 §5.3 的性能上限）。 */
let mounted = 0;

export function InkFrame({
  as = "div",
  radius = 14,
  stroke,
  tone = "ink",
  seed,
  fill = "sheet",
  openCorner = false,
  children,
  className = "",
  id,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const env = useInkEnv();
  const s = seed ?? hashSeed(id ?? `ink-frame:${radius}:${tone}`);
  const width = stroke ?? (env.elder ? 3 : 2);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(8, Math.ceil(r.width / 8) * 8);
      const h = Math.max(8, Math.ceil(r.height / 8) * 8);
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    mounted += 1;
    if (import.meta.env.DEV && mounted > 12) {
      console.warn(`[ink] 同屏手绘框 ${mounted} 个，超过 12 个请改用 CSS 边框降级（规范 §5.3）`);
    }
    return () => {
      mounted -= 1;
    };
  }, []);

  // 只借 "div" 的 ref 类型；真正渲染的标签仍是 as（section/article/li 都不影响 ref 的类型安全）。
  const Tag = as as "div";
  const d = box.w > 0 ? inkFramePath({ w: box.w, h: box.h, radius, stroke: width, seed: s, openCorner }) : "";

  return (
    <Tag
      ref={ref}
      className={`ink-frame ink-frame--fill-${fill} ink-frame--${tone} ${className}`.trim()}
      style={{ borderRadius: radiusToken(radius) }}
    >
      {d && (
        <svg
          className="ink-frame__ink"
          viewBox={`0 0 ${box.w} ${box.h}`}
          preserveAspectRatio="none"
          aria-hidden
          focusable="false"
        >
          <path d={d} fill="currentColor" />
        </svg>
      )}
      {children}
    </Tag>
  );
}
