/**
 * 旧接口的转接层：SurfPage / MemoryPage 还在用 `body` / `danger`，真正的确认框只有一份（ui/ConfirmDialog）。
 * 那两页迁到 ui 后删掉本文件。
 */
import { ConfirmDialog as UiConfirmDialog } from "../ui/Dialog";

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

export function ConfirmDialog({ body, danger = false, ...rest }: Props) {
  return <UiConfirmDialog {...rest} description={body} tone={danger ? "danger" : "default"} />;
}
