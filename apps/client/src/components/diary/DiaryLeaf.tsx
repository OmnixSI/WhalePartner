/**
 * 一页日记（规范 §7.2.2）：`.sheet` + 手绘框，左缘 24px 装订区（两个 14px 圆孔），
 * 顶部 DateStamp + 涂鸦 + 「写好啦」邮戳，正文写在横线本上（18/36，文楷）。
 *
 * 月 / 年模式：每篇折叠为 3 行 + 「展开看全文」，展开时靠 CSS 的 grid-rows 过渡，够轻、不抢滚动。
 * 天气 / 心情 / 小标题都来自后端 P-B 的可选字段：缺了就不画那一块，不留空框。
 */
import { useId, useState } from "react";
import { InkFrame, Stamp } from "../ink";
import { useInkEnv } from "../ink/useCalm";
import { DateStamp } from "./DateStamp";
import { Doodle } from "./Doodle";
import { RuledPaper } from "./RuledPaper";
import { diaryAt, moodOf, titleOf, weatherOf, type DiaryItemP2 } from "./types";

type Props = {
  item: DiaryItemP2;
  /** 周模式 = 整页；月 / 年模式 = 折叠（3 行 + 展开）。 */
  collapsed: boolean;
  /** 刚写完的那一次：邮戳落下来并动画。 */
  fresh?: boolean;
  fallbackTitle: string;
};

export function DiaryLeaf({ item, collapsed, fresh = false, fallbackTitle }: Props) {
  const env = useInkEnv();
  const [open, setOpen] = useState(!collapsed);
  const id = useId();
  const at = diaryAt(item);
  const weather = weatherOf(item);
  const mood = moodOf(item);
  const title = titleOf(item, at, fallbackTitle);
  const text = (item.diaryText ?? "").trim();
  const expanded = collapsed ? open : true;

  return (
    <InkFrame as="article" radius={20} stroke={2} tone="ink" fill="sheet" openCorner className="leaf" id={`leaf-${item.id}`}>
      <div className="leaf__binding" aria-hidden>
        <span className="leaf__hole" />
        <span className="leaf__hole" />
      </div>

      <div className="leaf__body">
        <header className="leaf__head">
          {at ? <DateStamp at={at} id={`${id}-stamp`} /> : <span className="leaf__nodate">{fallbackTitle}</span>}
          <div className="leaf__marks">
            {weather && (
              <span
                className="leaf__weather"
                role="img"
                aria-label={`今天心里的天气：${weather.label}`}
              >
                <Doodle name={weather.doodle} />
              </span>
            )}
            {!collapsed && (
              <span className="leaf__stamp">
                <Stamp kind="done" lines={["写好啦"]} animate={fresh && !env.calm} id={`stamp-${item.id}`} />
              </span>
            )}
          </div>
        </header>

        <h3 className="leaf__title">{title}</h3>

        <div className="leaf__fold" data-open={collapsed ? (open ? "true" : "false") : "true"}>
          <div className="leaf__paper">
            <RuledPaper className="leaf__ruled" />
            <p className="leaf__text">{text}</p>
          </div>
        </div>

        {collapsed && (
          <button type="button" className="btn btn--quiet leaf__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "收起来" : "展开看全文"}
          </button>
        )}

        <footer className="leaf__foot">
          {mood && <span className="leaf__mood">她今天：{mood}</span>}
          {item.sourceUrl && (
            <a className="leaf__source" href={item.sourceUrl} target="_blank" rel="noreferrer">
              看这条视频 ↗
            </a>
          )}
        </footer>

        {item.summary && expanded && (
          <details className="leaf__summary">
            <summary>她是从这些地方想起来的（1）</summary>
            <p>{item.summary}</p>
          </details>
        )}
      </div>
    </InkFrame>
  );
}
