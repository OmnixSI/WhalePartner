/**
 * 记忆详情（参照 astryx 的 Dialog）：ui/Dialog 里放分类徽章、正文、来源和原话。
 * 底部：「回到当时的聊天」（有链接才出现）+「忘掉这条」（近况类不出现）。
 * 后端没有「改记忆」的接口，所以这里只读，不画编辑框。
 */
import { Button, Dialog } from "../ui";
import { Icon } from "../ink-icons";
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
import "../pages/pages.css";

type Props = {
  entry: MemoryEntryP2 | null;
  onClose: () => void;
  onForget: (entry: MemoryEntryP2) => void;
};

export function MemoryDialog({ entry, onClose, onForget }: Props) {
  const group = entry ? groupInfo(groupOf(entry)) : null;
  const seq = entry ? seqLabel(entry.seq) : null;
  const quote = entry?.quote?.trim();

  return (
    <Dialog
      open={Boolean(entry)}
      onOpenChange={(next) => !next && onClose()}
      size="md"
      title={entry ? titleOf(entry) : "记忆"}
      footer={
        entry && (
          <>
            {canForget(entry) && (
              <Button variant="danger" onClick={() => onForget(entry)}>忘掉这条</Button>
            )}
            {entry.url && (
              <a className="ui-btn ui-press ui-focus ui-btn--secondary" href={entry.url} target="_blank" rel="noreferrer">
                回到当时的聊天
              </a>
            )}
          </>
        )
      }
    >
      {entry && group && (
        <div className="mdetail">
          <div className="mdetail__badges">
            <span className="pbadge" data-tone="accent">
              <Icon name={group.icon} size={16} />
              {group.label}
            </span>
            {seq && <span className="pbadge">No.{seq}</span>}
            {isSuperseded(entry) && <span className="pbadge" data-tone="warning">以前的记忆</span>}
          </div>
          {bodyOf(entry) && bodyOf(entry) !== titleOf(entry) && <p className="mdetail__text">{bodyOf(entry)}</p>}
          <dl className="mdetail__meta">
            <div><dt>时间</dt><dd>{dayLabel(entry.createdAt) || "—"}</dd></div>
            <div><dt>来源</dt><dd>{sourceLabel(entry)}</dd></div>
          </dl>
          {quote && <blockquote className="mdetail__quote">{quote}</blockquote>}
          {entry.sourceMissing && <p className="mdetail__missing">原话已不在了，只剩下这一条摘要。</p>}
        </div>
      )}
    </Dialog>
  );
}
