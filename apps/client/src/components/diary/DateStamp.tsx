/**
 * DateStamp（规范 §6.10）：左 `Fraunces 56px` 日（"07"，等宽数字），右上 13px 大写感的「NOV · 周六」，
 * 下方一条手绘线。整体是一个 `<time dateTime>`，屏幕阅读器一次读作「11月7日 周六」。
 */
import { InkLine } from "../ink";
import { MONTH_EN, WEEKDAY } from "./types";

type Props = {
  at: Date;
  /** 同页多枚日期戳时给一个稳定 id，墨线抖动才不会每次重排都变。 */
  id: string;
  /** 手机：日号收到 44px。 */
  compact?: boolean;
};

export function DateStamp({ at, id }: Props) {
  const day = String(at.getDate()).padStart(2, "0");
  const month = MONTH_EN[at.getMonth()];
  const weekday = WEEKDAY[at.getDay()];
  const iso = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

  return (
    <div className="dts">
      <time className="dts__time" dateTime={iso} aria-label={`${at.getMonth() + 1}月${at.getDate()}日 ${weekday}`}>
        <span className="dts__day" aria-hidden>
          {day}
        </span>
        <span className="dts__meta" aria-hidden>
          {month} · {weekday}
        </span>
      </time>
      <InkLine className="dts__rule" id={`dts-${id}`} />
    </div>
  );
}
