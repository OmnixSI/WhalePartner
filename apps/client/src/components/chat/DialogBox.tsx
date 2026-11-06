/**
 * 绘本字幕对话框（规范 §6.8）。
 * 她的话落在舞台下部：宽 min(640, 100%-48)，手机 100%-24；最小高 132，超出内部滚动；
 * 文楷 17 / 1.9，`white-space: pre-wrap`；左上探出名字牌，右下角按需盖 Day 1 邮戳。
 * 状态一律走 `data-state`（idle / loading / thinking / streaming / done / failed / offline），
 * 流式用 InkText 的「墨水渗入」，思考用 Thinking，完成后把全文写进视觉隐藏的 role="status" 一次。
 */
import { useState, type ReactNode } from "react";
import { InkFrame, Stamp } from "../ink";
import { InkText } from "./InkText";
import { NameTab } from "./NameTab";
import { Thinking } from "./Thinking";
import type { DialogState, Progress } from "./types";

type Props = {
  name: string;
  state: DialogState;
  /** 静态文案：问候 / 赶过来 / 没送出去 / 断网。 */
  text?: string;
  /** 流式分片（只给正在说话的这一条）。 */
  chunks?: string[];
  merged?: boolean;
  /** 首次进入的 Day 1 邮戳。 */
  stamp?: boolean;
  progress?: Progress;
  /** 只进「详情」折叠的技术原文。 */
  detail?: string;
  onRetry?: () => void;
  onGiveUp?: () => void;
  children?: ReactNode;
};

export function DialogBox({
  name,
  state,
  text = "",
  chunks = [],
  merged = true,
  stamp = false,
  progress,
  detail,
  onRetry,
  onGiveUp,
  children,
}: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const busy = state === "thinking" || state === "streaming";
  const live = state === "streaming";

  if (state === "blank") return null;

  const body = (() => {
    if (state === "thinking") return <Thinking progress={progress} onGiveUp={onGiveUp} />;
    if (live) return <p className="dlg__text"><InkText chunks={chunks} merged={merged} /></p>;
    return (
      <p className="dlg__text" role={state === "loading" ? "status" : undefined}>
        {text}
      </p>
    );
  })();

  return (
    <div className="dlg" data-state={state} aria-busy={busy}>
      <NameTab name={name} />
      <InkFrame className="dlg__sheet" radius={20} stroke={2} tone="ink" fill="sheet" openCorner>
        <div className="dlg__body">
          {body}
        </div>
        {stamp && <Stamp kind="postmark" lines={["Day 1"]} size={72} animate className="dlg__stamp" id="dlg-day1" />}
        {state === "offline" && (
          <div className="dlg__actions">
            <button type="button" className="btn btn--primary" onClick={onRetry}>
              再试一次
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              aria-expanded={showDetail}
              onClick={() => setShowDetail((v) => !v)}
            >
              详情
            </button>
          </div>
        )}
        {state === "offline" && showDetail && <p className="dlg__detail">{detail ?? "本机服务没有回应。"}</p>}
        {state === "failed" && (
          <div className="dlg__actions">
            <button
              type="button"
              className="btn btn--quiet"
              aria-expanded={showDetail}
              onClick={() => setShowDetail((v) => !v)}
            >
              详情
            </button>
          </div>
        )}
        {state === "failed" && showDetail && <p className="dlg__detail">{detail ?? "这句话没有发出去。"}</p>}
      </InkFrame>
      {state === "done" && (
        <span className="sr-only" role="status">
          {text || chunks.join("")}
        </span>
      )}
      {children}
    </div>
  );
}
