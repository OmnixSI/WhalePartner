/**
 * MiniCalendar（规范 §6.10）：自制月历，取代原生 `<input type=date>`。
 *
 * 7 列、每格 ≥44×44（老人模式 56）；有日记的日子右上角一个 6px 实心 `--accent` 点，
 * 并读作「11月5日，有日记」；今天用手绘圆圈标出（一条 SVG 弧线，不是 border-radius 假圆）；
 * 选中 = 实心 accent。翻月用两个 ≥44 的箭头按钮，键盘按原生 tab 顺序走。
 */
import { useMemo } from "react";
import { InkLine } from "../ink";
import "../../styles/diary.css"; // 记忆页也用这个组件；日记页懒加载后，样式得跟着组件走
import { MONTH_EN, WEEKDAY, isoDay, startOfDay } from "./types";

type Props = {
  /** 任意一个属于该月的日期。 */
  month: Date;
  value: Date | null;
  marks: Set<string>;
  onSelect: (date: Date) => void;
  onMonthChange: (month: Date) => void;
  /** 无障碍名用的月份，「11 月」。 */
  label?: string;
};

const CELL_WEEKDAY = ["一", "二", "三", "四", "五", "六", "日"] as const;

export function MiniCalendar({ month, value, marks, onSelect, onMonthChange, label }: Props) {
  const today = isoDay(new Date());
  const selected = value ? isoDay(value) : null;

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: Array<{ date: Date; key: string } | null> = [];
    for (let i = 0; i < lead; i += 1) out.push(null);
    for (let d = 1; d <= days; d += 1) {
      const date = new Date(month.getFullYear(), month.getMonth(), d);
      out.push({ date, key: isoDay(date) });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const monthLabel = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;

  return (
    <div className="mini" role="group" aria-label={label ?? `选日期，当前是 ${month.getMonth() + 1} 月`}>
      <div className="mini__head">
        <button
          type="button"
          className="mini__step"
          aria-label="上一个月"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          ‹
        </button>
        <span className="mini__month">
          <span className="mini__month-num">{monthLabel}</span>
          <span className="mini__month-en" aria-hidden>
            {MONTH_EN[month.getMonth()]}
          </span>
        </span>
        <button
          type="button"
          className="mini__step"
          aria-label="下一个月"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          ›
        </button>
      </div>

      <div className="mini__week" aria-hidden>
        {CELL_WEEKDAY.map((w) => (
          <span key={w} className="mini__weekday">
            {w}
          </span>
        ))}
      </div>

      <div className="mini__grid">
        {cells.map((cell, i) =>
          cell === null ? (
            <span key={`gap-${i}`} className="mini__cell mini__cell--gap" aria-hidden />
          ) : (
            <button
              key={cell.key}
              type="button"
              className="mini__cell"
              data-today={cell.key === today || undefined}
              data-selected={cell.key === selected || undefined}
              aria-current={cell.key === today ? "date" : undefined}
              aria-pressed={cell.key === selected}
              aria-label={`${cell.date.getMonth() + 1}月${cell.date.getDate()}日${marks.has(cell.key) ? "，有日记" : ""}`}
              onClick={() => onSelect(startOfDay(cell.date))}
            >
              <span className="mini__day">{cell.date.getDate()}</span>
              {marks.has(cell.key) && <span className="mini__dot" aria-hidden />}
              {cell.key === today && (
                <svg className="mini__ring" viewBox="0 0 44 44" aria-hidden focusable="false">
                  <path
                    d="M9 23c1-8 8-13 15-12 8 1 12 7 11 14-1 8-8 11-15 10-7-1-11-6-11-12 0-2 0-3 1-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          ),
        )}
      </div>

      <InkLine className="mini__rule" id="mini-rule" />
      <p className="mini__foot">
        {value ? `${value.getMonth() + 1} 月 ${value.getDate()} 日 · ${WEEKDAY[value.getDay()]}` : "挑一天看看"}
      </p>
    </div>
  );
}
