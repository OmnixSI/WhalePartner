/**
 * 卡片：一块内容的容器。三种外观：
 * - flat：只有细边，列表里一组设置、一条记忆；
 * - raised：浮起一点，页面上需要被注意的一块；
 * - interactive：整块可点（打开详情），hover 上浮 2px、阴影淡入。卡片里不要再放第二个主操作。
 */
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import { cx } from "./cx";
import "./shared.css";
import "./Card.css";

type Pad = "none" | "md" | "lg";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { variant?: "flat" | "raised"; padding?: Pad }>(
  function Card({ variant = "flat", padding = "md", className, ...rest }, ref) {
    return <div ref={ref} className={cx("ui-card", `ui-card--${variant}`, `ui-card--pad-${padding}`, className)} {...rest} />;
  },
);

/** 整块可点的卡片：渲染成 <button>，键盘与读屏天然可用 */
export const CardButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { padding?: Pad; "data-preview"?: "hover" | "active" | "focus" }>(
  function CardButton({ padding = "md", className, type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} className={cx("ui-card ui-card--interactive ui-press ui-focus", `ui-card--pad-${padding}`, className)} {...rest} />;
  },
);
