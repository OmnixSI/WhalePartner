/**
 * 往回翻（规范 §6.8 Backlog）：桌上的视觉小说回放。
 * 宽 360，头 64：标题 + `···`（清空聊天记录，走 ConfirmDialog）+ 桌面「收起」。
 * 她的话没有气泡：一段连续发言（间隔 <5 分钟）首行贴 32px 贴纸头像 + 14px 名字，正文文楷 17/1.9；
 * 块间距 20、段内 8；日期分隔是一条手绘线 + 居中 Fraunces 的「11·07 周六」。
 * 列表用 Virtuoso：只在你已经在底部时才自动跟随；不在底部时来了新消息，右下出现「有新消息」小签（点它回到最新）。
 */
import { DropdownMenu } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../../icons";
import { CharacterMark } from "../CharacterMark";
import { Slip } from "./Slip";
import { splitReply } from "../../lib/reply";
import type { Turn } from "./types";

type Props = {
  name: string;
  turns: Turn[];
  onClear: () => void;
  onClose?: () => void;
  variant?: "aside" | "sheet";
};

type Row =
  | { key: string; kind: "day"; label: string }
  | { key: string; kind: "her"; turn: Turn; first: boolean }
  | { key: string; kind: "me"; turn: Turn };

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const pad = (n: number) => String(n).padStart(2, "0");

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getMonth() + 1)}·${pad(d.getDate())} ${WEEKDAYS[d.getDay()]}`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相邻两条她的话相隔 <5 分钟算同一段连续发言（中间夹了你的话就一定断开）。 */
function sameRun(prev: Turn | undefined, next: Turn): boolean {
  if (!prev || prev.role !== "her") return false;
  const a = new Date(prev.at).getTime();
  const b = new Date(next.at).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(b - a) < 5 * 60 * 1000;
}

function buildRows(turns: Turn[]): Row[] {
  const rows: Row[] = [];
  let day = "";
  let prev: Turn | undefined;
  for (const turn of turns) {
    // 还没吐出内容的她的话不进往回翻（对话台上正在说）；没送出去的话也不进（它没成为历史）。
    if (turn.role === "her" && !turn.text.trim()) continue;
    if (turn.role === "me" && turn.status === "failed") continue;
    const label = dayLabel(turn.at);
    if (label && label !== day) {
      day = label;
      rows.push({ key: `day-${turn.key}`, kind: "day", label });
      prev = undefined;
    }
    if (turn.role === "her") {
      rows.push({ key: turn.key, kind: "her", turn, first: !sameRun(prev, turn) });
    } else {
      rows.push({ key: turn.key, kind: "me", turn });
    }
    prev = turn;
  }
  return rows;
}

export function Backlog({ name, turns, onClear, onClose, variant = "aside" }: Props) {
  const rows = useMemo(() => buildRows(turns), [turns]);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const list = useRef<VirtuosoHandle>(null);
  const jumped = useRef(false);
  const atBottomRef = useRef(true);
  const lastCount = useRef(0);

  useEffect(() => {
    if (jumped.current && rows.length > lastCount.current && !atBottomRef.current) setUnseen((n) => n + rows.length - lastCount.current);
    lastCount.current = rows.length;
  }, [rows.length]);

  const onBottomChange = (bottom: boolean) => {
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };

  // 历史是异步到的：第一次拿到内容时补一次「贴底」，之后交给 followOutput。
  useEffect(() => {
    if (jumped.current || rows.length === 0) return;
    jumped.current = true;
    list.current?.scrollToIndex({ index: "LAST", align: "end" });
  }, [rows.length]);

  const renderRow = (row: Row) => {
    if (row.kind === "day") {
      return (
        <div className="bl__day">
          <span className="bl__dayText">{row.label}</span>
        </div>
      );
    }
    if (row.kind === "me") {
      return (
        <div className="bl__slipRow">
          <Slip id={row.turn.key} text={row.turn.text} time={clock(row.turn.at)} />
        </div>
      );
    }
    const { turn, first } = row;
    return (
      <article className={`bl__cap${first ? " bl__cap--first" : ""}`}>
        {first && (
          <span className="bl__avatar" aria-hidden>
            <CharacterMark />
          </span>
        )}
        <div className="bl__capBody">
          {first && <span className="bl__capName">{name}</span>}
          {splitReply(turn.text).map((part, index) => (
            <p key={index} className="bl__capText">{part.trim()}</p>
          ))}
          {turn.proactive && <p className="bl__recall">主动找你</p>}
          {turn.interrupted && <p className="bl__recall">没说完就被打断了</p>}
          {turn.recalled && turn.recalled.length > 0 && (
            <p className="bl__recall">想起来 · {turn.recalled.join("；")}</p>
          )}
          <time className="bl__time" dateTime={turn.at}>
            {clock(turn.at)}
          </time>
        </div>
      </article>
    );
  };

  return (
    <section className={`bl bl--${variant}`} aria-label="往回翻">
      <header className="bl__head">
        <h2 className="bl__title">往回翻</h2>
        <div className="bl__tools">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label="更多"><Icon name="more" size={20} /></IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
                <DropdownMenu.Item className="menu__item menu__item--danger" onSelect={onClear}>
                  清空聊天记录
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {onClose && (
            <Button variant="ghost" onClick={onClose}>收起</Button>
          )}
        </div>
      </header>

      <div className="bl__listWrap" role="log" aria-live="off">
        {rows.length === 0 ? (
          <p className="bl__empty">还没有说过的话。第一张纸条，从这里递过去。</p>
        ) : (
          <Virtuoso
            ref={list}
            data={rows}
            followOutput={(bottom) => (bottom ? "smooth" : false)}
            alignToBottom
            atBottomThreshold={80}
            atBottomStateChange={onBottomChange}
            increaseViewportBy={200}
            components={{ Footer: () => <div className="bl__tail" aria-hidden /> }}
            itemContent={(_, row) => <div className="bl__row">{renderRow(row)}</div>}
          />
        )}
      </div>

      {!atBottom && rows.length > 0 && (
        <Button
          className="bl__latest"
          onClick={() => list.current?.scrollToIndex({ index: "LAST", behavior: "smooth" })}
        >
          {unseen > 0 ? "有新消息" : "回到最新"}
        </Button>
      )}
    </section>
  );
}
