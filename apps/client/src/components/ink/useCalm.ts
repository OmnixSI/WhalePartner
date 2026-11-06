/**
 * 手绘基元的运行环境（规范 §4.9 / §5.5）：
 * - `calm`：`prefers-reduced-motion` 或 `data-motion="calm"`（老人模式在 a11y.ts 里也会写成 calm）。
 *   为真时所有动画直接给完成态：手绘线不「画出来」、邮戳不「落下来」、浪不「涨上来」。
 * - `dark`：深海夜，浪要叠平涂月与星。
 * - `narrow`：手机，水彩晕边滤镜要关掉（手机只用平涂）。
 * - `elder`：老人模式，手绘框的线加粗到 3。
 * 四个值都从 DOM 读，所以换主题/换设置不用重挂组件（MutationObserver 会通知）。
 */
import { useSyncExternalStore } from "react";

const KEY_ATTRS = ["data-motion", "data-elder", "data-theme"];

function subscribe(onChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mqNarrow = window.matchMedia("(max-width: 767px)");
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: KEY_ATTRS });
  mq.addEventListener("change", onChange);
  mqNarrow.addEventListener("change", onChange);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", onChange);
    mqNarrow.removeEventListener("change", onChange);
  };
}

function snapshot(): string {
  const root = document.documentElement;
  const calm = root.dataset.motion === "calm" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dark = root.getAttribute("data-theme") === "dark";
  const narrow = window.matchMedia("(max-width: 767px)").matches;
  const elder = root.getAttribute("data-elder") === "on";
  return `${calm ? 1 : 0}${dark ? 1 : 0}${narrow ? 1 : 0}${elder ? 1 : 0}`;
}

export type InkEnv = { calm: boolean; dark: boolean; narrow: boolean; elder: boolean };

export function useInkEnv(): InkEnv {
  // 没挂到 DOM 前按「安静」处理：宁可静态，也不要闪一下动画。
  const s = useSyncExternalStore(subscribe, snapshot, () => "1110");
  return { calm: s[0] === "1", dark: s[1] === "1", narrow: s[2] === "1", elder: s[3] === "1" };
}
