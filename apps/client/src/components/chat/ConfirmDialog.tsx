/**
 * 统一确认框（规范 §6.9）：Radix AlertDialog + 手绘框。
 * 标题是问句、正文一句后果 + 一句例外、按钮写具体动词（不写「确定 / 取消」）；
 * 默认聚焦最安全的「先留着」，Esc 关闭，关闭后焦点回到触发元素（Radix 负责）。
 * 全站删除动作都走这里，不用 window.confirm。
 */
import { AlertDialog } from "radix-ui";
import { InkFrame } from "../ink";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  cancelLabel,
  confirmLabel,
  danger = false,
  onConfirm,
}: Props) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="confirm" aria-describedby="confirm-body">
          <InkFrame className="confirm__panel" radius={20} stroke={2} tone={danger ? "alert" : "ink"} fill="sheet" openCorner>
            <h2 className="confirm__title">{title}</h2>
            <p className="confirm__body" id="confirm-body">
              {body}
            </p>
            <div className="confirm__actions">
              <AlertDialog.Cancel className="btn btn--primary">{cancelLabel}</AlertDialog.Cancel>
              <AlertDialog.Action
                className={`btn ${danger ? "btn--danger" : "btn--secondary"}`}
                onClick={onConfirm}
              >
                {confirmLabel}
              </AlertDialog.Action>
            </div>
          </InkFrame>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
