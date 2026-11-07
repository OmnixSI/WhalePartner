/**
 * PostcardDetail（规范 §7.7.4 的展开态）：大图 + 完整摘要 + 她的感想 + 来源，
 * 底部三个动作：跟她聊聊这个 / 打开原链接 / 忘掉。
 * 「和她聊聊这个」跳到聊天页，把见闻标题和链接通过 `?quote=` 带过去，由聊天页预填进输入框。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "radix-ui";
import { InkFrame } from "../ink";
import { Icon } from "../ink-icons";
import { chatQuoteHref, siteLabel, thumbUrl, whenText, type SurfFeedItem } from "../../lib/surf";

type Props = {
  item: SurfFeedItem | null;
  onClose: () => void;
  onForget: (item: SurfFeedItem) => void;
  onOpenUrl: (url: string) => void;
};

export function PostcardDetail({ item, onClose, onForget, onOpenUrl }: Props) {
  const navigate = useNavigate();
  const [broken, setBroken] = useState(false);
  const open = Boolean(item);

  useEffect(() => setBroken(false), [item?.id, item?.thumb]);

  // 把标题和链接用 ?quote= 带到聊天页，由聊天页预填进输入框（不会自动发送）。
  const talkAbout = (target: SurfFeedItem) => {
    onClose();
    navigate(chatQuoteHref(target));
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="pdlg" aria-describedby={item ? "pdlg-body" : undefined}>
          {item && (
            <InkFrame radius={20} stroke={2} tone="ink" fill="sheet" openCorner className="pdlg__panel">
              <header className="pdlg__head">
                <span className="pdlg__badge">
                  <Icon name={item.kind === "video" ? "video" : "newspaper"} size={24} />
                  <span>
                    {siteLabel(item.sourceSite)} · {whenText(item.createdAt)}
                  </span>
                </span>
                <Dialog.Close className="btn btn--quiet" aria-label="关上">
                  关上
                </Dialog.Close>
              </header>

              <Dialog.Title className="pdlg__title">{item.title}</Dialog.Title>

              <span className="pdlg__photo" aria-label={item.thumbError ?? undefined}>
                {item.thumb && !broken
                  ? <img src={thumbUrl(item.id)} alt="" onError={() => setBroken(true)} />
                  : <span>{item.thumbError ?? (broken ? "封面暂不可用" : "暂无封面")}</span>}
              </span>

              {item.comment && (
                <p className="pdlg__say">
                  <span className="pdlg__say-label">她说</span>
                  {item.comment}
                </p>
              )}

              <p className="pdlg__body" id="pdlg-body">
                {item.summary || "摘要还在整理，稍后刷新就有了。"}
              </p>

              {item.tags.length > 0 && (
                <p className="pdlg__tags">
                  {item.tags.map((tag) => (
                    <span key={tag} className="pcard__tag">#{tag}</span>
                  ))}
                </p>
              )}

              <p className="pdlg__source">
                来源：<a
                  href={item.url}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenUrl(item.url);
                  }}
                >{item.url}</a>
              </p>

              <div className="pdlg__actions">
                <button type="button" className="btn btn--primary" onClick={() => talkAbout(item)}>
                  和她聊聊这个
                </button>
                <button type="button" className="btn btn--secondary" onClick={(event) => { event.stopPropagation(); onOpenUrl(item.url); }}>
                  打开原链接
                </button>
                <button
                  type="button"
                  className="btn btn--quiet pdlg__forget"
                  onClick={() => {
                    onClose();
                    onForget(item);
                  }}
                >
                  忘掉
                </button>
              </div>
            </InkFrame>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
