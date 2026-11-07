/**
 * 底部导航条（规范 §7.2.2）：`‹ 前一天` / `[ 11月 ▾ 日历 ]` / `后一天 ›` / 回到今天。
 *
 * 三个主按钮 56×48；中间的日历按钮打开 Popover 里的 MiniCalendar，取代原生 date input。
 * 范围模式决定前后一步的粒度：周 = 一天，月 = 一个月，年 = 一年（按钮文字跟着换，不撒谎）。
 */
import { Popover } from "radix-ui";
import { useState } from "react";
import { MiniCalendar } from "./MiniCalendar";
import { startOfDay, type RangeMode } from "./types";

type Props = {
  mode: RangeMode;
  cursor: Date;
  marks: Set<string>;
  onCursor: (date: Date) => void;
  onToday: () => void;
};

const STEP: Record<RangeMode, { prev: string; next: string; shift: (d: Date, n: number) => Date }> = {
  week: {
    prev: "前一天",
    next: "后一天",
    shift: (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n),
  },
  month: {
    prev: "上个月",
    next: "下个月",
    shift: (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1),
  },
  year: {
    prev: "去年",
    next: "今年",
    shift: (d, n) => new Date(d.getFullYear() + n, 0, 1),
  },
};

export function PageBar({ mode, cursor, marks, onCursor, onToday }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const step = STEP[mode];
  const dateLabel = `${cursor.getMonth() + 1}月${cursor.getDate()}日`;
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][cursor.getDay()];

  return (
    <div className="pagebar">
      <button type="button" className="pagebar__step" onClick={() => onCursor(startOfDay(step.shift(cursor, -1)))}>
        <span aria-hidden>‹</span> {step.prev}
      </button>

      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setMonth(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
        }}
      >
        <Popover.Trigger className="pagebar__cal" aria-label={`选日期，当前是 ${dateLabel} ${weekday}`}>
          {dateLabel} {weekday} <span aria-hidden>▾</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="pop pagebar__pop" sideOffset={10} align="center" aria-label="选日期">
            <MiniCalendar
              month={month}
              value={cursor}
              marks={marks}
              onMonthChange={setMonth}
              onSelect={(date) => {
                onCursor(date);
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <button type="button" className="pagebar__step" onClick={() => onCursor(startOfDay(step.shift(cursor, 1)))}>
        {step.next} <span aria-hidden>›</span>
      </button>

      <button type="button" className="btn btn--quiet pagebar__today" onClick={onToday}>
        回到今天
      </button>
    </div>
  );
}
