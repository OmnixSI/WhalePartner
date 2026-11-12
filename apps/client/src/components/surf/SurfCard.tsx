/**
 * 见闻卡片（参照 astryx 的 Card 网格 / Feed 条目）：封面 + 类型徽章 + 标题 + 她说 + 标签 + 来源与时间。
 * 标题是一个撑满整张卡的按钮（打开详情）；底部的「打开原链接」「忘掉」叠在它上面，各自可点。
 */
import { useState } from "react";
import { Button, Card } from "../ui";
import { Icon } from "../ink-icons";
import { siteLabel, thumbUrl, whenText, type SurfFeedItem } from "../../lib/surf";

type Props = {
  item: SurfFeedItem;
  /** 24 小时内、本机还没看过。 */
  fresh?: boolean;
  onOpen: (item: SurfFeedItem) => void;
  onForget: (item: SurfFeedItem) => void;
  onOpenUrl: (url: string) => void;
};

export function SurfCard({ item, fresh = false, onOpen, onForget, onOpenUrl }: Props) {
  const [broken, setBroken] = useState(false);
  const site = siteLabel(item.sourceSite);
  const hasPhoto = Boolean(item.thumb) && !broken;
  const video = item.kind === "video";

  return (
    <li className="scard-item">
      <Card className="scard" padding="none" variant="raised">
        <div className="scard__cover" data-empty={hasPhoto ? "off" : "on"} title={item.thumbError ?? undefined}>
          {hasPhoto ? (
            <img className="scard__img" src={thumbUrl(item.id)} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span className="scard__letter" aria-hidden>{site.slice(0, 1).toUpperCase()}</span>
          )}
          <span className="pbadge scard__kind" data-tone={video ? "accent" : "info"}>
            <Icon name={video ? "video" : "newspaper"} size={16} />
            {video ? "视频" : "网页"}
          </span>
          {fresh && <span className="pbadge scard__fresh" data-tone="success">新</span>}
        </div>

        <div className="scard__body">
          <p className="scard__meta">
            <span className="scard__site">{site}</span>
            <span aria-hidden>·</span>
            <time dateTime={item.createdAt}>{whenText(item.createdAt)}</time>
          </p>
          <h3 className="scard__title">
            <button type="button" className="scard__open" data-surf-open onClick={() => onOpen(item)}>
              <span className="scard__open-text">{item.title}</span>
            </button>
          </h3>
          {item.comment && (
            <p className="scard__say">
              <span className="scard__say-label">她说</span>
              {item.comment}
            </p>
          )}
          {item.tags.length > 0 && (
            <p className="scard__tags">
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="pbadge">#{tag}</span>
              ))}
            </p>
          )}
        </div>

        <div className="scard__foot">
          <Button variant="secondary" onClick={() => onOpenUrl(item.url)}>
            {video ? "打开原视频" : "打开网页"}
          </Button>
          <Button variant="ghost" onClick={() => onForget(item)}>忘掉</Button>
        </div>
      </Card>
    </li>
  );
}
