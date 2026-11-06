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
      onToast(`已开始下载：${result.filename}（去下载文件夹看看）。`);
    } catch {
      setExportFailed(true);
      onUnavailable();
      onToast("没能导出，现在拿不到。");
    } finally {
      setExporting(false);
    }
  };

  const runClear = async () => {
    setClearing(true);
    const ok = await clearHistory();
    setClearing(false);
    setClearOpen(false);
    if (ok) onToast("聊天记录清空了。");
    else onToast("没清成，现在拿不到。");
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
        <p className="set-data__title">导出我的全部数据</p>
        <p className="set-data__desc">聊天、她记得的事、日记、她逛到的东西，整包导出到下载文件夹。</p>
        <button type="button" className="btn btn--secondary" disabled={exportBlocked} onClick={() => void runExport()}>
          {exporting ? "正在打包…" : "导出我的全部数据"}
        </button>
        {(offline || exportFailed) && <p className="set-data__bad">现在拿不到，等服务起来再导出。</p>}
      </div>

      <div className="set-data__row">
        <p className="set-data__title">清空聊天记录</p>
        <p className="set-data__desc">只删聊天和只从聊天里记住的事；日记、看过的视频网页都留着。</p>
        <button type="button" className="btn btn--secondary" disabled={clearing} onClick={() => setClearOpen(true)}>
          清空聊天记录
        </button>
      </div>

      <div className="set-data__row" data-tone="danger">
        <p className="set-data__title">删除我的全部数据</p>
        <p className="set-data__desc">删掉就找不回来。删之前建议先导出一份。</p>
        <button
          type="button"
          className="btn btn--danger"
          disabled={offline || deleting}
          onClick={() => setDeleteOpen(true)}
        >
          {deleting ? "正在删…" : "删除我的全部数据"}
        </button>
        {(offline || deleteFailed) && <p className="set-data__bad">现在拿不到，什么都没删。</p>}
      </div>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="清空所有聊天？"
        confirmLabel="清空"
        busy={clearing}
        onConfirm={() => void runClear()}
      >
        聊天原文和只从聊天里记住的事都会删掉；看过的视频、网页、她自己逛到的东西和日记里的内容会留着。
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除我的全部数据？"
        confirmLabel="全部删掉"
        ackLabel="我知道删除后找不回来"
        danger
        busy={deleting}
        confirmDisabled={offline}
        onConfirm={() => void runDelete()}
      >
        聊天、她记得的事、日记、她逛到的东西、额度记录和你的昵称都会删掉，B 站登录也会退出。建议先导出一份。
      </ConfirmDialog>
    </div>
  );
}
