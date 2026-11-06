/**
 * PostcardCard（规范 §7.7.4）：一张剪报 / 明信片。
 * 形状 = `.sheet` + 上缘锯齿 + 左上胶带 + 轻微旋转；照片带白边、略微歪，右下压一枚圆形邮戳
 * （站点 · 日期）。照片和文字各是一个按钮，都能打开详情；底部两个动作「打开」「忘掉」。
 */
import { useState } from "react";
import { Tape, Stamp } from "../ink";
import { Icon } from "../ink-icons";
import { useInkEnv } from "../ink/useCalm";
import { hashSeed } from "../../lib/ink";
import { siteLabel, stampDate, thumbUrl, timeOf, type SurfFeedItem } from "../../lib/surf";

type Props = {
  item: SurfFeedItem;
  /** 24 小时内、本机还没看过。 */
  fresh?: boolean;
  onOpen: (item: SurfFeedItem) => void;
  onForget: (item: SurfFeedItem) => void;
  onOpenUrl: (url: string) => void;
};

export function PostcardCard({ item, fresh = false, onOpen, onForget, onOpenUrl }: Props) {
  const env = useInkEnv();
  const [broken, setBroken] = useState(false);
  const angle = env.calm || env.elder ? 0 : ((hashSeed(String(item.id)) % 5) - 2) * 0.5;
  const site = siteLabel(item.sourceSite);
  const hasPhoto = Boolean(item.thumb) && !broken;
  const kindText = item.kind === "video" ? "看视频" : "读网页";

  return (
    <li className="pcard">
      <div className="pcard__sheet" style={angle === 0 ? undefined : { transform: `rotate(${angle}deg)` }}>
        <Tape color={item.kind === "video" ? "b" : "c"} w={64} h={18} angle={env.calm ? 0 : -3} className="pcard__tape" />

        <div className="pcard__visual">
          <button
            type="button"
            className="pcard__photo-btn"
            onClick={() => onOpen(item)}
            aria-label={`看这张剪报：${item.title}`}
          >
            <span className="pcard__photo" data-empty={hasPhoto ? "off" : "on"} aria-hidden>
              {hasPhoto ? (
                <img className="pcard__img" src={thumbUrl(item.id)} alt="" loading="lazy" onError={() => setBroken(true)} />
              ) : (
                <span className="pcard__letter">{site.slice(0, 1).toUpperCase()}</span>
              )}
            </span>
          </button>
          <span className="pcard__stamp" aria-hidden>
            <Stamp kind="postmark" lines={[site, stampDate(item.createdAt)]} size={72} />
          </span>
          {fresh && (
            <span className="pcard__fresh">
              <Stamp kind="label" lines={["新"]} />
            </span>
          )}
        </div>

        <button
          type="button"
          className="pcard__body"
          onClick={() => onOpen(item)}
          aria-label={`${item.title}，${kindText}，打开详情`}
        >
          <span className="pcard__title">{item.title}</span>
          {item.comment && (
            <span className="pcard__say">
              <span className="pcard__say-label">她说：</span>
              <span className="pcard__say-text">{item.comment}</span>
            </span>
          )}
          {item.tags.length > 0 && (
            <span className="pcard__tags">
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="pcard__tag">
                  #{tag}
                </span>
              ))}
            </span>
          )}
        </button>

        <div className="pcard__foot">
          <span className="pcard__kind">
            <Icon name={item.kind === "video" ? "video" : "newspaper"} size={20} />
            <span className="pcard__meta">
              {kindText}·{timeOf(item.createdAt)}
            </span>
          </span>
          <span className="pcard__actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onOpenUrl(item.url)}>
              打开
            </button>
            <button type="button" className="btn btn--quiet btn--sm pcard__forget" onClick={() => onForget(item)}>
              忘掉
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}
