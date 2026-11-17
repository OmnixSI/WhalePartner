import { useMemo } from "react";
import { m } from "../../i18n";
import { isoDay, monthCells, shortTheme } from "./types";

const WEEKDAYS = m.diary.date.weekdayMon;

type DiaryCalendarProps = {
  month: Date;
  selectedDate: string | null;
  themesByDate: Map<string, string[]>;
  onSelect: (date: Date) => void;
};

export function DiaryCalendar({ month, selectedDate, themesByDate, onSelect }: DiaryCalendarProps) {
  const today = isoDay(new Date());
  const cells = useMemo(() => monthCells(month), [month.getFullYear(), month.getMonth()]);
  const recordCount = Array.from(themesByDate.values()).reduce((count, themes) => count + themes.length, 0);

  return (
    <section className="diary-calendar" aria-label={m.diary.calendar.ariaLabel(month)}>
      <div className="diary-calendar__week" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>

      <div className="diary-calendar__grid">
        {cells.map((cell, index) => {
          if (!cell) return <span key={`gap-${index}`} className="diary-calendar__gap" aria-hidden="true" />;

          const themes = themesByDate.get(cell.key) ?? [];
          const hasRecords = themes.length > 0;
          const isToday = cell.key === today;
          const label = hasRecords
            ? m.diary.calendar.dayWithRecords(cell.date, themes.length, shortTheme(themes[0], 24))
            : m.diary.calendar.dayEmpty(cell.date);

          return (
            <button
              key={cell.key}
              type="button"
              className="diary-calendar__day"
              data-has-records={hasRecords || undefined}
              data-selected={cell.key === selectedDate || undefined}
              data-today={isToday || undefined}
              aria-label={label}
              aria-pressed={cell.key === selectedDate}
              aria-current={isToday ? "date" : undefined}
              onClick={() => onSelect(cell.date)}
            >
              <span className="diary-calendar__dayhead">
                <span className="diary-calendar__date">
                  {cell.date.getDate()}
                  {isToday && (
                    <svg className="diary-calendar__today-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
                      <path
                        d="M9 23c1-8 8-13 15-12 8 1 12 7 11 14-1 8-8 11-15 10-7-1-11-6-11-12 0-2 0-3 1-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </span>
                {hasRecords && (
                  <span className="diary-calendar__mark" aria-hidden="true">
                    {themes.length > 1 ? themes.length : "✳"}
                  </span>
                )}
              </span>
              {hasRecords && <span className="diary-calendar__theme">{shortTheme(themes[0], 14)}</span>}
              {themes.length > 1 && <span className="diary-calendar__more">{m.diary.calendar.more(themes.length - 1)}</span>}
            </button>
          );
        })}
      </div>

      <div className="diary-calendar__legend">
        <span><i className="diary-calendar__legend-mark" aria-hidden="true" /> {m.diary.calendar.legendRecord}</span>
        <span><i className="diary-calendar__legend-ring" aria-hidden="true" /> {m.diary.calendar.legendToday}</span>
      </div>
      {recordCount === 0 && <p className="diary-calendar__empty">{m.diary.calendar.empty}</p>}
    </section>
  );
}

type DiaryYearOverviewProps = {
  year: number;
  countByMonth: Map<number, number>;
  onSelectMonth: (month: Date) => void;
};

export function DiaryYearOverview({ year, countByMonth, onSelectMonth }: DiaryYearOverviewProps) {
  const months = Array.from({ length: 12 }, (_, index) => index);

  return (
    <section className="diary-year" aria-label={m.diary.calendar.yearAria(year)}>
      <p className="diary-year__intro">{m.diary.calendar.yearIntro}</p>
      <div className="diary-year__grid">
        {months.map((month) => {
          const count = countByMonth.get(month) ?? 0;
          const label = count > 0 ? m.diary.calendar.monthWithRecords(count) : m.diary.calendar.monthEmpty;
          return (
            <button
              key={month}
              type="button"
              className="diary-year__month"
              data-has-records={count > 0 || undefined}
              aria-label={m.diary.calendar.monthAria(year, month, label)}
              onClick={() => onSelectMonth(new Date(year, month, 1))}
            >
              <span className="diary-year__name">{m.diary.date.monthName(month)}</span>
              <span className="diary-year__count">{count > 0 ? label : m.diary.calendar.blank}</span>
              {count > 0 && <span className="diary-year__mark" aria-hidden="true">✳</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
