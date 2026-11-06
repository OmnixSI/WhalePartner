/**
 * 二次确认对话框（规范 §7.4.7 / §9.1「确认」）：正文先说后果，安全选项在上、默认聚焦；
 * `ackLabel` 给了就多一道"我知道……"的勾选，勾上之前确认键不可用。
 *
 * 用 Radix Dialog：焦点陷阱、Esc、焦点回收都是默认行为，不自己实现。
 */
import { Dialog } from "radix-ui";
import { useEffect, useId, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  danger?: boolean;
  busy?: boolean;
  /** 例：「我知道删除后找不回来」；勾上才放行确认 */
  ackLabel?: string;
  /** 额外禁用确认（例如后端拿不到） */
  confirmDisabled?: boolean;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel = "先留着",
  onConfirm,
  danger = false,
  busy = false,
  ackLabel,
  confirmDisabled = false,
}: Props) {
  const [acked, setAcked] = useState(false);
  const ackId = useId();
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) setAcked(false);
  }, [open]);

  const blocked = busy || confirmDisabled || (Boolean(ackLabel) && !acked);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="set-dialog" aria-labelledby={titleId} aria-describedby={descId}>
          <Dialog.Title className="set-dialog__title" id={titleId}>
            {title}
          </Dialog.Title>
          <Dialog.Description className="set-dialog__body" id={descId}>
            {children}
          </Dialog.Description>
          {ackLabel && (
            <label className="set-ack" htmlFor={ackId}>
              <input
                id={ackId}
                type="checkbox"
                className="set-ack__box"
                checked={acked}
                onChange={(event) => setAcked(event.target.checked)}
              />
              <span className="set-ack__text">{ackLabel}</span>
            </label>
          )}
          <div className="set-dialog__actions">
            <Dialog.Close className="btn btn--secondary">{cancelLabel}</Dialog.Close>
            <button
              type="button"
              className={danger ? "btn btn--danger" : "btn btn--primary"}
              disabled={blocked}
              onClick={onConfirm}
            >
              {busy ? "正在做…" : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
