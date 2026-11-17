/**
 * 见闻详情（参照 astryx 的 Dialog）：封面 + 她说 + 摘要 + 标签 + 来源。
 * 底部三个动作：和她聊聊这个（跳聊天页，用 `?quote=` 预填，不自动发送）/ 打开原链接 / 忘掉。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Dialog } from "../ui";
import { Icon } from "../ink-icons";
import { chatQuoteHref, siteLabel, thumbUrl, whenText, type SurfFeedItem } from "../../lib/surf";
import { m } from "../../i18n";

type Props = {
  item: SurfFeedItem | null;
  onClose: () => void;
  onForget: (item: SurfFeedItem) => void;
  onOpenUrl: (url: string) => void;
};

export function SurfDetail({ item, onClose, onForget, onOpenUrl }: Props) {
  const navigate = useNavigate();
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [item?.id, item?.thumb]);

  const talkAbout = (target: SurfFeedItem) => {
    onClose();
    navigate(chatQuoteHref(target));
  };

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(next) => !next && onClose()}
      size="lg"
      title={item?.title ?? m.surf.detail.fallbackTitle}
      footer={
        item && (
          <>
            <Button variant="ghost" onClick={() => { onClose(); onForget(item); }}>{m.surf.detail.forget}</Button>
            <Button variant="secondary" onClick={() => onOpenUrl(item.url)}>{m.surf.detail.openLink}</Button>
            <Button variant="primary" onClick={() => talkAbout(item)}>{m.surf.detail.talk}</Button>
          </>
        )
      }
    >
      {item && (
        <div className="sdetail">
          <p className="sdetail__meta">
            <span className="pbadge" data-tone={item.kind === "video" ? "accent" : "info"}>
              <Icon name={item.kind === "video" ? "video" : "newspaper"} size={16} />
              {item.kind === "video" ? m.surf.detail.video : m.surf.detail.web}
            </span>
            <span>{siteLabel(item.sourceSite)} · {whenText(item.createdAt)}</span>
          </p>

          <div className="sdetail__cover" data-empty={item.thumb && !broken ? "off" : "on"}>
            {item.thumb && !broken
              ? <img src={thumbUrl(item.id)} alt="" onError={() => setBroken(true)} />
              : <span>{item.thumbError ?? (broken ? m.surf.detail.coverUnavailable : m.surf.detail.noCover)}</span>}
          </div>

          {item.comment && (
            <p className="sdetail__say">
              <span className="sdetail__say-label">{m.surf.detail.says}</span>
              {item.comment}
            </p>
          )}

          <p className="sdetail__body">{item.summary || m.surf.detail.summaryPending}</p>

          {item.tags.length > 0 && (
            <p className="sdetail__tags">
              {item.tags.map((tag) => <span key={tag} className="pbadge">#{tag}</span>)}
            </p>
          )}

          <p className="sdetail__source">
            {m.surf.detail.source}<a
              href={item.url}
              onClick={(event) => {
                event.preventDefault();
                onOpenUrl(item.url);
              }}
            >{item.url}</a>
          </p>
        </div>
      )}
    </Dialog>
  );
}
