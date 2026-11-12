/**
 * 对话框（Radix Dialog）与确认框（Radix AlertDialog）。
 * - Dialog：需要用户在当前页之上完成一件小事（改名、选角色）。标题必填；底部按钮右对齐，主按钮在最右。
 * - ConfirmDialog：不可撤销操作的最后一道确认。焦点默认落在「取消」上；tone="danger" 时确认按钮是危险按钮。
 * 窄屏（<560px）从底部升起，桌面居中。进出场只动 opacity / transform。
 */
import { AlertDialog as A, Dialog as D } from "radix-ui";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { Close } from "./glyphs";
import "./shared.css";
import "./Dialog.css";

/**
 * 受控打开（没有 Trigger）时，Radix 不知道该把焦点还给谁，关闭后会落到 body。
 * 打开的那一刻（弹层还没挂上，焦点还在触发它的元素上）记下来，关闭时还回去；那个元素已经不在了就交给 Radix 默认处理。
 */
function useRestoreFocus(open: boolean | undefined) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return (event: Event) => {
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected && el !== document.body) {
      event.preventDefault();
      el.focus();
    }
  };
}

export function Dialog({ open, onOpenChange, title, description, children, footer, trigger, size = "md", className }: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 底部操作区，通常是 [次按钮, 主按钮] */
  footer?: ReactNode;
  /** 不受控用法：点它打开 */
  trigger?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const restoreFocus = useRestoreFocus(open);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <D.Trigger asChild>{trigger}</D.Trigger> : null}
      <D.Portal>
        <D.Overlay className="ui-dialog__scrim" />
        <D.Content className={cx("ui-dialog", `ui-dialog--${size}`, className)} onCloseAutoFocus={restoreFocus} {...(description ? {} : { "aria-describedby": undefined })}>
          <header className="ui-dialog__head">
            <D.Title className="ui-dialog__title">{title}</D.Title>
            <D.Close asChild>
              <button type="button" className="ui-dialog__close ui-press ui-focus" aria-label="关闭"><Close /></button>
            </D.Close>
          </header>
          {description ? <D.Description className="ui-dialog__desc">{description}</D.Description> : null}
          {children ? <div className="ui-dialog__body">{children}</div> : null}
          {footer ? <footer className="ui-dialog__foot">{footer}</footer> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel = "先不了", tone = "default", onConfirm, busy = false }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** 写动作本身：「删除这篇日记」，不写「确定」 */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
}) {
  const restoreFocus = useRestoreFocus(open);
  return (
    <A.Root open={open} onOpenChange={onOpenChange}>
      <A.Portal>
        <A.Overlay className="ui-dialog__scrim" />
        <A.Content className="ui-dialog ui-dialog--sm" onCloseAutoFocus={restoreFocus}>
          <A.Title className="ui-dialog__title">{title}</A.Title>
          {description ? <A.Description className="ui-dialog__desc">{description}</A.Description> : null}
          <footer className="ui-dialog__foot">
            <A.Cancel asChild><Button variant="secondary">{cancelLabel}</Button></A.Cancel>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              loading={busy}
              onClick={async () => { await onConfirm(); onOpenChange(false); }}
            >
              {confirmLabel}
            </Button>
          </footer>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
