/**
 * 绘本字幕对话框（规范 §6.8）。
 * 她的话落在舞台下部：宽 min(640, 100%-48)，手机 100%-24；高度随内容、超出内部滚动；
 * 文楷 17 / 1.9，`white-space: pre-wrap`；左上探出名字牌。一张平的纸，没有手绘边框、没有邮戳。
 * 状态一律走 `data-state`（idle / loading / thinking / streaming / done / failed / offline），
 * 流式用 InkText 的「墨水渗入」，思考用 Thinking，完成后把全文写进视觉隐藏的 role="status" 一次。
 */
import { useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { InkText } from "./InkText";
import { NameTab } from "./NameTab";
import { Thinking } from "./Thinking";
import type { DialogState, Progress } from "./types";
import type { AvatarEmotion } from "../../avatar/model.config";

type Props = {
  name: string;
  state: DialogState;
  /** 这句话的情绪：名字牌的点、读屏的话都跟着它，正文本身保持干净。 */
  emotion?: AvatarEmotion;
  /** 静态文案：问候 / 赶过来 / 没送出去 / 断网。 */
  text?: string;
  /** 流式分片（只给正在说话的这一条）。 */
  chunks?: string[];
  merged?: boolean;
  progress?: Progress;
  /** 只进「详情」折叠的技术原文。 */
  detail?: string;
  onRetry?: () => void;
  /** 失败态的「再试一次」。 */
  onRetryFailed?: () => void;
  /** 按句分条出现时，下一条还在「打字」。 */
  typing?: boolean;
  /** 读屏播报的完整原文：按句分条时字幕会逐句变长，播报只在全部亮出后给这一份全文，不随字幕逐句更新。 */
  announce?: string;
  onGiveUp?: () => void;
  children?: ReactNode;
};

export function DialogBox({
  name,
  state,
  emotion = "neutral",
  text = "",
  chunks = [],
  merged = true,
  progress,
  detail,
  onRetry,
  onRetryFailed,
  typing = false,
  announce,
  onGiveUp,
  children,
}: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const busy = state === "thinking" || state === "streaming";
  const live = state === "streaming";

  if (state === "blank") return null;

  const body = (() => {
    if (state === "thinking") return <Thinking progress={progress} onGiveUp={onGiveUp} />;
    if (live) return <p className="dlg__text"><InkText chunks={chunks} merged={merged} />{typing && <span className="dlg__typing" aria-hidden> …</span>}</p>;
    return (
      <p className="dlg__text" role={state === "loading" ? "status" : state === "failed" || state === "offline" ? "alert" : undefined}>
        {text}{typing && <span className="dlg__typing" aria-hidden> …</span>}
      </p>
    );
  })();

  return (
    <div className="dlg" data-state={state} data-emotion={emotion} aria-busy={busy}>
      <NameTab name={name} emotion={emotion} />
      <div className="dlg__sheet">
        <div className="dlg__body">
          {body}
        </div>
        {state === "offline" && (
          <div className="dlg__actions">
            <Button variant="primary" onClick={onRetry}>再试一次</Button>
            <Button variant="ghost" aria-expanded={showDetail} onClick={() => setShowDetail((v) => !v)}>详情</Button>
          </div>
        )}
        {state === "offline" && showDetail && <p className="dlg__detail">{detail ?? "本机服务没有回应。"}</p>}
        {state === "failed" && (
          <div className="dlg__actions">
            {onRetryFailed && (
              <Button variant="primary" onClick={onRetryFailed}>再试一次</Button>
            )}
            <Button variant="ghost" aria-expanded={showDetail} onClick={() => setShowDetail((v) => !v)}>详情</Button>
          </div>
        )}
        {state === "failed" && showDetail && <p className="dlg__detail">{detail ?? "这句话没有发出去。"}</p>}
      </div>
      {state === "done" && !typing && (
        <span className="sr-only" role="status" aria-live="polite">
          {announce ?? (text || chunks.join(""))}
        </span>
      )}
      {children}
    </div>
  );
}
