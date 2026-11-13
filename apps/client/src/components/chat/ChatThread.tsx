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
};

/** 窄屏（<1180）聊天页的「最近的 N 条」：默认收起成一个按钮，点开才看到最近两条；完整历史走「往回翻」。 */
export function ChatThread({ name, turns, excludeKey }: Props) {
  const [open, setOpen] = useState(false);
  const peek = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const visible = visibleTurns(turns, excludeKey, 2);
  const last = visible[visible.length - 1];
  const signature = last ? `${last.key}\u0000${last.text}` : "";

  useEffect(() => {
    const node = list.current;
    if (!node || !atBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, [signature]);

  useEffect(() => {
    if (open) panel.current?.focus();
    else if (wasOpen.current) peek.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (visible.length === 0) return null;
  if (!open) {
    return (
      <Button ref={peek} variant="secondary" className="chat-thread__peek" aria-expanded={false} aria-controls="chat-thread-compact" onClick={() => setOpen(true)}>
        最近的 {visible.length} 条
      </Button>
    );
  }

  let lastDay = "";
  return (
    <Card
      ref={panel}
      variant="flat"
      padding="md"
      className="chat-thread chat-thread--compact"
      id="chat-thread-compact"
      role="dialog"
      aria-label="最近的对话"
      aria-modal={false}
      tabIndex={-1}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
    >
      <header className="chat-thread__head">
        <h2 className="chat-thread__title">最近的对话</h2>
        <Button variant="ghost" aria-expanded onClick={() => setOpen(false)}>收起</Button>
      </header>
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
    </Card>
  );
}
