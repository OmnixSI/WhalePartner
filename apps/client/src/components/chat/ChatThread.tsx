import { useEffect, useRef, useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { CharacterMark } from "../CharacterMark";
import { stripEmotionTags } from "../../lib/emotion";
import { clock, dayKey, dayLabel, visibleTurns } from "./chatThreadUtils";
import type { Turn } from "./types";

type Props = {
  name: string;
  turns: Turn[];
  /** 只在 streaming 时排除正在舞台字幕里显示的那一条。 */
  excludeKey?: string;
  variant?: "aside" | "compact";
  onOpenBacklog?: () => void;
  /** done 状态给读屏播一次全文。 */
  announce?: boolean;
  announceText?: string;
};

/** astryx ChatLayout 风格的消息列表：宽屏右侧整栏，窄屏只留最近两条。 */
export function ChatThread({ name, turns, excludeKey, variant = "aside", onOpenBacklog, announce = false, announceText = "" }: Props) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const limit = variant === "aside" ? 40 : 2;
  const visible = visibleTurns(turns, excludeKey, limit);
  const last = visible[visible.length - 1];
  const signature = last ? `${last.key}\u0000${last.text}` : "";

  useEffect(() => {
    const node = list.current;
    if (!node || !atBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [signature]);

  if (visible.length === 0) return null;
  if (variant === "compact" && !open) {
    return (
      <Button variant="secondary" className="chat-thread__peek" aria-expanded={false} onClick={() => setOpen(true)}>
        最近的 {visible.length} 条
      </Button>
    );
  }

  let lastDay = "";
  return (
    <Card variant="flat" padding="md" className={`chat-thread chat-thread--${variant}`}>
      {variant === "aside" ? (
        <header className="chat-thread__head">
          <h2 className="chat-thread__title">最近的对话</h2>
          {onOpenBacklog && <Button variant="ghost" onClick={onOpenBacklog}>全部记录</Button>}
        </header>
      ) : (
        <header className="chat-thread__head">
          <h2 className="chat-thread__title">最近的对话</h2>
          <Button variant="ghost" aria-expanded onClick={() => setOpen(false)}>收起</Button>
        </header>
      )}
      <div
        className="chat-thread__list"
        ref={list}
        tabIndex={0}
        role="log"
        aria-label="最近的对话"
        onScroll={() => {
          const node = list.current;
          if (node) atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {visible.map((turn) => {
          const key = dayKey(turn.at);
          const divider = key && key !== lastDay ? dayLabel(turn.at) : "";
          if (key) lastDay = key;
          const text = stripEmotionTags(turn.text);
          return (
            <div key={turn.key} className="chat-thread__item">
              {divider && (
                <div className="chat-thread__day" role="separator">
                  <span>{divider}</span>
                </div>
              )}
              <div className="chat-thread__msg" data-role={turn.role}>
                {turn.role === "her" && <CharacterMark className="chat-thread__avatar" />}
                <div className="chat-thread__body">
                  <div className="chat-thread__meta">
                    <span>{turn.role === "her" ? name : "你"}</span>
                    <time dateTime={turn.at}>{clock(turn.at)}</time>
                  </div>
                  <p className="chat-thread__bubble">{text}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {announce && announceText.trim() && (
        <span className="sr-only" role="status" aria-live="polite">{stripEmotionTags(announceText)}</span>
      )}
    </Card>
  );
}
