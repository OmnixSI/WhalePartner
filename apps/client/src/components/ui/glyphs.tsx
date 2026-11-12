/**
 * 组件内部用的小字形（16×16，currentColor）。手绘墨线图标（components/ink-icons）是给导航与内容的；
 * 下拉箭头、勾、关闭、转圈这类控件符号要求几何、清楚、尺寸一致，单独画。
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

export const ChevronDown = (p: P) => <svg {...base} {...p}><path d="M4 6l4 4 4-4" /></svg>;
export const Check = (p: P) => <svg {...base} {...p}><path d="M3.5 8.5l3 3 6-7" /></svg>;
export const Close = (p: P) => <svg {...base} {...p}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const Spinner = (p: P) => (
  <svg {...base} className="ui-spinner" {...p}>
    <path d="M8 2a6 6 0 1 1-6 6" />
  </svg>
);
