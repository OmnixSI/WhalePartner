/**
 * 提示（Radix Tooltip）：只给图标按钮补一句名字或快捷键，不放必须读到的信息（触屏上看不到）。
 * 自带 Provider，单独用即可；同一屏很多个时在外层放一个 <TooltipProvider> 共享延迟。
 *
 *   <Tooltip content="新对话"><IconButton label="新对话">…</IconButton></Tooltip>
 */
import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";
import "./shared.css";
import "./Tooltip.css";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={450} skipDelayDuration={250}>{children}</T.Provider>;
}

export function Tooltip({ content, children, side = "top", open, defaultOpen }: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** 预览页钉住显示用 */
  open?: boolean;
  defaultOpen?: boolean;
}) {
  return (
    <TooltipProvider>
      <T.Root open={open} defaultOpen={defaultOpen}>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content side={side} sideOffset={6} collisionPadding={8} className="ui-tooltip ui-pop">
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </TooltipProvider>
  );
}
