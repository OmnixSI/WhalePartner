import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
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
  const monthOptions = Array.from({ length: 12 }, (_, month) => ({ value: String(month), label: `${month + 1} 月` }));
  const yearOptions = Array.from({ length: 8 }, (_, index) => {
    const year = cursor.getFullYear() - 5 + index;
    return { value: String(year), label: `${year} 年` };
  });

  return (
    <nav className="pagebar" aria-label="日记时间导航">
      <Tooltip content={step.prev}>
        <Button
          variant="secondary"
          className="pagebar__step pagebar__step--prev"
          aria-label={step.prev}
          icon={<span aria-hidden="true">‹</span>}
          onClick={() => onCursor(startOfDay(step.shift(cursor, -1)))}
        >
          <span className="pagebar__word">{step.prev}</span>
        </Button>
      </Tooltip>
      {mode !== "year" && (
        <strong className="pagebar__range" aria-live="polite">
          {mode === "month" ? `${cursor.getFullYear()}年` : label}
        </strong>
      )}
      {mode === "month" && (
        <Select
          className="pagebar__jump"
          aria-label="跳到月份"
          value={String(cursor.getMonth())}
          options={monthOptions}
          onValueChange={(value) => onCursor(new Date(cursor.getFullYear(), Number(value), 1))}
        />
      )}
      {mode === "year" && (
        <Select
          className="pagebar__jump"
          aria-label="跳到年份"
          value={String(cursor.getFullYear())}
          options={yearOptions}
          onValueChange={(value) => onCursor(new Date(Number(value), 0, 1))}
        />
      )}
      <Tooltip content={step.next}>
        <Button
          variant="secondary"
          className="pagebar__step pagebar__step--next"
          aria-label={step.next}
          icon={<span aria-hidden="true">›</span>}
          onClick={() => onCursor(startOfDay(step.shift(cursor, 1)))}
        >
          <span className="pagebar__word">{step.next}</span>
        </Button>
      </Tooltip>
      <Button variant="ghost" className="pagebar__today" onClick={onToday}>
        回到今天
      </Button>
    </nav>
  );
}
