/**
 * 二次确认对话框：正文先说后果；`ackLabel` 给了就多一道"我知道……"的勾选，勾上之前确认键不可用。
 * 外壳是 ui/Dialog（焦点陷阱、Esc、焦点回收都由它处理）；ui 的 ConfirmDialog 没有勾选和禁用，所以这里自己搭底栏。
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

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

  useEffect(() => {
    if (!open) setAcked(false);
  }, [open]);

  const blocked = busy || confirmDisabled || (Boolean(ackLabel) && !acked);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={title}
      description={children}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} disabled={blocked} loading={busy} onClick={onConfirm}>
            {busy ? "正在做…" : confirmLabel}
          </Button>
        </>
      }
    >
      {ackLabel && (
        <label className="set-ack" htmlFor={ackId}>
          <input id={ackId} type="checkbox" className="set-ack__box" checked={acked} onChange={(event) => setAcked(event.target.checked)} />
          <span>{ackLabel}</span>
        </label>
      )}
    </Dialog>
  );
}
