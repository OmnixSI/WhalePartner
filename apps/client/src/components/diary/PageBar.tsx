import { rangeOf, shiftMonth, shiftYear, startOfDay, type RangeMode } from "./types";

type Props = {
  mode: RangeMode;
  cursor: Date;
  onCursor: (date: Date) => void;
  onToday: () => void;
};

const STEP: Record<RangeMode, { prev: string; next: string; shift: (date: Date, amount: number) => Date }> = {
  week: {
    // 周视图一页是整周（周一到周日），所以一次翻 7 天。
    prev: "前一周",
    next: "后一周",
    shift: (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount * 7),
  },
  month: {
    prev: "上个月",
    next: "下个月",
    shift: shiftMonth,
  },
  year: {
    prev: "上一年",
    next: "下一年",
    shift: shiftYear,
  },
};

function rangeLabel(mode: RangeMode, cursor: Date): string {
  if (mode === "year") return `${cursor.getFullYear()}年`;
  if (mode === "month") return `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;

  const range = rangeOf("week", cursor);
  const start = range.start;
  const end = range.end;
  const startLabel = `${start.getMonth() + 1}月${start.getDate()}日`;
  const endLabel = `${end.getMonth() + 1}月${end.getDate()}日`;
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getFullYear()}年${startLabel}—${end.getFullYear()}年${endLabel}`;
  }
  return `${start.getFullYear()}年 ${startLabel}—${endLabel}`;
}

export function PageBar({ mode, cursor, onCursor, onToday }: Props) {
  const step = STEP[mode];
  const label = rangeLabel(mode, cursor);

  return (
    <nav className="pagebar" aria-label="日记时间导航">
      <button
        type="button"
        className="pagebar__step"
        aria-label={step.prev}
        onClick={() => onCursor(startOfDay(step.shift(cursor, -1)))}
      >
        <span aria-hidden="true">‹</span>
        <span className="pagebar__word">{step.prev}</span>
      </button>
      <strong className="pagebar__range" aria-live="polite">{label}</strong>
      <button
        type="button"
        className="pagebar__step"
        aria-label={step.next}
        onClick={() => onCursor(startOfDay(step.shift(cursor, 1)))}
      >
        <span className="pagebar__word">{step.next}</span>
        <span aria-hidden="true">›</span>
      </button>
      <button type="button" className="btn btn--quiet pagebar__today" onClick={onToday}>
        回到今天
      </button>
    </nav>
  );
}
