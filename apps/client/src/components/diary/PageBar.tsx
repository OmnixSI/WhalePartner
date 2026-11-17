import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Tooltip } from "../ui/Tooltip";
import { m } from "../../i18n";
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
    prev: m.diary.pageBar.week.prev,
    next: m.diary.pageBar.week.next,
    shift: (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount * 7),
  },
  month: {
    prev: m.diary.pageBar.month.prev,
    next: m.diary.pageBar.month.next,
    shift: shiftMonth,
  },
  year: {
    prev: m.diary.pageBar.year.prev,
    next: m.diary.pageBar.year.next,
    shift: shiftYear,
  },
};

function rangeLabel(mode: RangeMode, cursor: Date): string {
  if (mode === "year") return m.diary.date.year(cursor.getFullYear());
  if (mode === "month") return m.diary.date.yearMonth(cursor);

  const range = rangeOf("week", cursor);
  return m.diary.date.weekRange(range.start, range.end);
}

export function PageBar({ mode, cursor, onCursor, onToday }: Props) {
  const step = STEP[mode];
  const label = rangeLabel(mode, cursor);
  const monthOptions = Array.from({ length: 12 }, (_, month) => ({ value: String(month), label: m.diary.date.monthOption(month) }));
  const yearOptions = Array.from({ length: 8 }, (_, index) => {
    const year = cursor.getFullYear() - 5 + index;
    return { value: String(year), label: m.diary.date.yearOption(year) };
  });

  return (
    <nav className="pagebar" aria-label={m.diary.pageBar.navAria}>
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
          {mode === "month" ? m.diary.date.year(cursor.getFullYear()) : label}
        </strong>
      )}
      {mode === "month" && (
        <Select
          className="pagebar__jump"
          aria-label={m.diary.pageBar.jumpMonth}
          value={String(cursor.getMonth())}
          options={monthOptions}
          onValueChange={(value) => onCursor(new Date(cursor.getFullYear(), Number(value), 1))}
        />
      )}
      {mode === "year" && (
        <Select
          className="pagebar__jump"
          aria-label={m.diary.pageBar.jumpYear}
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
        {m.diary.pageBar.today}
      </Button>
    </nav>
  );
}
