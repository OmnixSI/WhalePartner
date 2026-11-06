/**
 * StateBlock（规范 §6.10）：空 / 加载 / 错误 / 离线通用。
 * 贴纸 + 标题（20 文楷）+ 正文（16）+ 至多 1 个 primary + 可选 quiet「详情」；居中，最大宽 360。
 * `loading` 用 `role="status"`，`error` 用 `role="alert"`。
 *
 * 日记页与记忆页共用（两页的 WRITE 范围只有 `components/diary` 与 `components/memory`，
 * 所以放在 diary 一侧，记忆页 import 过来）。
 */
import { useState, type ReactNode } from "react";
import { InkLine } from "../ink";
import { WhaleSticker, type StickerMood } from "../WhaleSticker";
import { useInkEnv } from "../ink/useCalm";

type Props = {
  kind: "loading" | "empty" | "error";
  title?: string;
  body?: string;
  action?: { label: string; onClick: () => void } | null;
  /** 错误详情：只进折叠，不进正文。 */
  detail?: string;
  mood?: StickerMood;
  children?: ReactNode;
};

export function StateBlock({ kind, title, body, action = null, detail, mood, children }: Props) {
  const calm = useInkEnv().calm;
  const [showDetail, setShowDetail] = useState(false);
  const sticker: StickerMood = mood ?? (kind === "error" ? "worried" : kind === "loading" ? "sleepy" : "hold");

  return (
    <div className={`state state--${kind}`} role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}>
      <WhaleSticker mood={sticker} className="state__sticker" />
      {title && <h3 className="state__title">{title}</h3>}
      {body ? <p className="state__body">{body}</p> : null}
      {kind === "loading" && <InkLine className="state__ink" id="state-ink" draw={calm ? "none" : "loop"} />}
      {children}
      <div className="state__actions">
        {action && (
          <button type="button" className="btn btn--primary" onClick={action.onClick}>
            {action.label}
          </button>
        )}
        {detail && (
          <button
            type="button"
            className="btn btn--quiet"
            aria-expanded={showDetail}
            onClick={() => setShowDetail((v) => !v)}
          >
            详情
          </button>
        )}
      </div>
      {detail && showDetail && <p className="state__detail">{detail}</p>}
    </div>
  );
}
