/**
 * PostcardMini（规范 §7.7.5）：聊天里那张窄明信片 —— 左缩略图、右标题与站点·时间，
 * 右端两个安静按钮「打开」「看她的见闻 ›」。高 72，整张可聚焦。
 * 聊天页接上 attachment 之后直接用这个组件；这一阶段先用见闻页的详情里预览。
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { siteLabel, stampDate, thumbUrl, timeOf, type SurfFeedItem } from "../../lib/surf";

type Props = {
  item: Pick<SurfFeedItem, "id" | "kind" | "title" | "sourceSite" | "thumb" | "url" | "createdAt">;
  onOpenUrl: (url: string) => void;
};

export function PostcardMini({ item, onOpenUrl }: Props) {
  const navigate = useNavigate();
  const [broken, setBroken] = useState(false);
  const hasPhoto = Boolean(item.thumb) && !broken;
  const site = siteLabel(item.sourceSite);
  return (
    <div className="pmini" role="group" aria-label={`她分享的见闻：${item.title}`}>
      <span className="pmini__photo" data-empty={hasPhoto ? "off" : "on"} aria-hidden>
        {hasPhoto ? <img src={thumbUrl(item.id)} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span>{site.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className="pmini__text">
        <span className="pmini__title">{item.title}</span>
        <span className="pmini__meta">
          {site}·{stampDate(item.createdAt)} {timeOf(item.createdAt)}
        </span>
      </span>
      <span className="pmini__actions">
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={(event) => {
            event.stopPropagation();
            onOpenUrl(item.url);
          }}
        >
          打开原链接
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => navigate("/surf")}>
          看她的见闻 ›
        </button>
      </span>
    </div>
  );
}
