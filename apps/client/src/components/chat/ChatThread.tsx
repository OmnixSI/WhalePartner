import { useEffect, useRef } from "react";
import { Card } from "../ui/Card";
import { CharacterMark } from "../CharacterMark";
import type { Turn } from "./types";

type Props = {
  name: string;
  turns: Turn[];
  /** 当前正显示在舞台字幕里的那一条，避免和上面的列表重复。 */
  excludeKey?: string;
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const pad = (n: number) => String(n).padStart(2, "0");

function dayKey(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "今天";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "昨天";
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${WEEKDAYS[date.getDay()]}`;
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 舞台上方的一段近期对话，按天分隔；完整历史仍在「往回翻」。 */
export function ChatThread({ name, turns, excludeKey }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const visible = turns
    .filter((turn) => turn.key !== excludeKey && turn.text.trim() !== "" && !(turn.role === "me" && turn.status === "failed"))
    .slice(-3);

  useEffect(() => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible.length]);

  if (visible.length === 0) return null;

  let lastDay = "";
  return (
    <Card variant="flat" padding="md" className="chat-thread" role="log" aria-label="之前的对话">
      <div className="chat-thread__list" ref={list} tabIndex={0} aria-label="之前的对话">
        {visible.map((turn) => {
          const key = dayKey(turn.at);
          const divider = key && key !== lastDay ? dayLabel(turn.at) : "";
          if (key) lastDay = key;
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
                  <p className="chat-thread__bubble">{turn.text}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
