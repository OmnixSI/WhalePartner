/**
 * 标签页（Radix Tabs）。两种外观：
 * - line：页面级分区（日记 / 记忆的分类），下划线指示；
 * - segmented：2–4 个互斥选项的切换（视图、筛选），轨道 + 白块。
 * 指示器只做 scaleX / opacity 过渡。
 */
import { Tabs as T } from "radix-ui";
import type { ReactNode } from "react";
import { cx } from "./cx";
import "./shared.css";
import "./Tabs.css";

export type TabItem = { value: string; label: ReactNode; disabled?: boolean };

export function Tabs({ items, value, defaultValue, onValueChange, variant = "line", label, children, className }: {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  variant?: "line" | "segmented";
  /** 读屏用的整体名字，例如「日记视图」 */
  label: string;
  /** 每个面板用 <TabPanel value=…>；segmented 当筛选器用时可以不放面板 */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <T.Root value={value} defaultValue={defaultValue ?? items[0]?.value} onValueChange={onValueChange} className={cx("ui-tabs", className)}>
      <T.List aria-label={label} className={cx("ui-tabs__list", `ui-tabs__list--${variant}`)}>
        {items.map((it) => (
          <T.Trigger key={it.value} value={it.value} disabled={it.disabled} className="ui-tabs__tab ui-press ui-focus">
            {variant === "segmented" ? <span className="ui-tabs__seg" aria-hidden="true" /> : null}
            <span className="ui-tabs__text">{it.label}</span>
            {variant === "line" ? <span className="ui-tabs__bar" aria-hidden="true" /> : null}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return <T.Content value={value} className={cx("ui-tabs__panel ui-focus", className)}>{children}</T.Content>;
}
