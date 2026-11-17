/**
 * 我的数据（规范 §7.4.7）：导出 / 清空聊天 / 删除全部。
 *
 * 三条规则：
 * 1. 全部走现成的客户端 lib（`data.ts` / `chat.ts`），页面不自己造接口；
 * 2. 接口拿不到就说「现在拿不到」并把按钮禁掉，不假装成功；
 * 3. 「删除全部」必须两步：先摆后果 → 再勾「我知道删除后找不回来」→ 才能按；
 *    删成功后清掉本机 `wp.*` 并重载，回到首次引导的空态。
 */
import { useState } from "react";
import { clearHistory } from "../../lib/chat";
import { clearLocalPreferences, deleteAll, exportAll } from "../../lib/data";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "../ui/Button";
import { m } from "../../i18n";

type Props = {
  /** 后端探测不到（fetchHealth 失败）：导出/删除一并禁用 */
  offline: boolean;
  onToast: (text: string) => void;
  /** 请求真失败了：把页面切到"现在拿不到" */
  onUnavailable: () => void;
};


export function DataSection({ offline, onToast, onUnavailable }: Props) {
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const exportBlocked = offline || exporting;

  const runExport = async () => {
    if (exportBlocked) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const result = await exportAll();
      onToast(m.setup.data.exportedToast(result.filename));
    } catch {
      setExportFailed(true);
      onUnavailable();
      onToast(m.setup.data.exportFailedToast);
    } finally {
      setExporting(false);
    }
  };

  const runClear = async () => {
    setClearing(true);
    const { ok } = await clearHistory();
    setClearing(false);
    setClearOpen(false);
    if (ok) onToast(m.setup.data.clearedToast);
    else onToast(m.setup.data.clearFailedToast);
  };

  const runDelete = async () => {
    if (offline || deleting) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await deleteAll();
      // 先清本机偏好，再重载：重载后 wp.onboarded 已不在，自然回到首次引导。
      clearLocalPreferences();
      window.location.reload();
    } catch {
      setDeleting(false);
      setDeleteFailed(true);
      onUnavailable();
    }
  };

  return (
    <div className="set-data">
      <div className="set-data__row">
        <p className="set-data__title">{m.setup.data.exportTitle}</p>
        <p className="set-data__desc">{m.setup.data.exportDesc}</p>
        <Button variant="secondary" disabled={exportBlocked} onClick={() => void runExport()}>
          {exporting ? m.setup.data.exporting : m.setup.data.exportButton}
        </Button>
        {(offline || exportFailed) && <p className="set-data__bad">{m.setup.data.exportUnavailable}</p>}
      </div>

      <div className="set-data__row">
        <p className="set-data__title">{m.setup.data.clearTitle}</p>
        <p className="set-data__desc">{m.setup.data.clearDesc}</p>
        <Button variant="secondary" disabled={clearing} onClick={() => setClearOpen(true)}>
          {m.setup.data.clearButton}
        </Button>
      </div>

      <div className="set-data__row" data-tone="danger">
        <p className="set-data__title">{m.setup.data.deleteTitle}</p>
        <p className="set-data__desc">{m.setup.data.deleteDesc}</p>
        <Button
          variant="danger"
          disabled={offline || deleting}
          onClick={() => setDeleteOpen(true)}
        >
          {deleting ? m.setup.data.deleting : m.setup.data.deleteButton}
        </Button>
        {(offline || deleteFailed) && <p className="set-data__bad">{m.setup.data.deleteUnavailable}</p>}
      </div>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={m.setup.data.clearDialogTitle}
        confirmLabel={m.setup.data.clearConfirm}
        busy={clearing}
        onConfirm={() => void runClear()}
      >
        {m.setup.data.clearDialogBody}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={m.setup.data.deleteDialogTitle}
        confirmLabel={m.setup.data.deleteConfirm}
        ackLabel={m.setup.data.deleteAck}
        danger
        busy={deleting}
        confirmDisabled={offline}
        onConfirm={() => void runDelete()}
      >
        {m.setup.data.deleteDialogBody}
      </ConfirmDialog>
    </div>
  );
}
