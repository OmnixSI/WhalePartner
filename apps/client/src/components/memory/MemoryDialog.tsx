/**
 * 记忆详情（规范 §7.3.4「纸条展开」）：点卡片 → 纸条摊开。
 *
 * 规范里的共享元素（layoutId + domMax）在这个阶段先降成「淡入 + 轻微上浮」：
 * 桌面居中、手机底部抽屉，都是令牌里的时长；reduced-motion / calm 下只淡入。
 * 底部按钮：secondary「回到当时的聊天」（有链接才出现）+ danger-outline「忘掉这条」（近况类不出现），
 * 两者间距 ≥16，危险按钮永远不是实心。
 */
import { Dialog } from "radix-ui";
import { Icon } from "../ink-icons";
import { InkFrame } from "../ink";
import {
  bodyOf,
  canForget,
  dayLabel,
  groupInfo,
  groupOf,
  isSuperseded,
  seqLabel,
  sourceLabel,
  titleOf,
  type MemoryEntryP2,
} from "./types";

type Props = {
  entry: MemoryEntryP2 | null;
  onClose: () => void;
  onForget: (entry: MemoryEntryP2) => void;
};

export function MemoryDialog({ entry, onClose, onForget }: Props) {
  const open = Boolean(entry);
  const group = entry ? groupInfo(groupOf(entry)) : null;
  const seq = entry ? seqLabel(entry.seq) : null;
  const quote = entry?.quote?.trim();

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="mdlg" aria-describedby={entry ? "mdlg-body" : undefined}>
          {entry && group && (
            <InkFrame radius={20} stroke={2} tone="ink" fill="sheet" openCorner className="mdlg__panel">
              <header className="mdlg__head">
                <span className="mdlg__badge">
                  <span className="mdlg__icon" aria-hidden>
                    <Icon name={group.icon} size={24} />
                  </span>
                  <span className="mdlg__cat">{group.label}</span>
                  {seq && <span className="mdlg__seq">No.{seq}</span>}
                </span>
                <Dialog.Close className="btn btn--quiet mdlg__close" aria-label="关上">
                  关上
                </Dialog.Close>
              </header>

              <Dialog.Title className="mdlg__title">{titleOf(entry)}</Dialog.Title>
              <p className="mdlg__text" id="mdlg-body">
                {bodyOf(entry)}
              </p>

              <p className="mdlg__meta">
                {dayLabel(entry.createdAt)}
                {entry.createdAt ? " · " : ""}
                {sourceLabel(entry)}
                {isSuperseded(entry) ? " · 以前的记忆" : ""}
              </p>

              {quote && (
                <blockquote className="mdlg__quote">
                  <p>{quote}</p>
                </blockquote>
              )}

              {entry.sourceMissing && <p className="mdlg__missing">原话已不在了，只剩下这一条摘要。</p>}

              <div className="mdlg__actions">
                {entry.url && (
                  <a className="btn btn--secondary" href={entry.url} target="_blank" rel="noreferrer">
                    回到当时的聊天
                  </a>
                )}
                {canForget(entry) && (
                  <button type="button" className="btn mdlg__forget" onClick={() => onForget(entry)}>
                    忘掉这条
                  </button>
                )}
              </div>
            </InkFrame>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
