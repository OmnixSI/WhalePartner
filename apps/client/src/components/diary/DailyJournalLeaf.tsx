import { useId, useState } from "react";
import type { DailyJournal } from "../../lib/diary";
import { Card } from "../ui/Card";
import { DateStamp } from "./DateStamp";
import { RuledPaper } from "./RuledPaper";
import { journalDate } from "./types";

type Props = {
  journal: DailyJournal;
  collapsed: boolean;
  fresh?: boolean;
};

const SOURCE_KIND: Record<DailyJournal["sources"][number]["type"], string> = {
  chat: "聊天",
  video: "视频",
  web: "网页",
  learned: "学到的事",
  reflection: "回想",
};

export function DailyJournalLeaf({ journal, collapsed, fresh = false }: Props) {
  const [open, setOpen] = useState(!collapsed);
  const stampId = useId();
  const at = journalDate(journal.localDate);
  const expanded = !collapsed || open;

  return (
    <Card role="article" variant="flat" padding="lg" className="leaf" id={`leaf-${journal.id}`}>
      <div className="leaf__body">
        <header className="leaf__head">
          {at ? <DateStamp at={at} id={`${stampId}-journal`} /> : <span className="leaf__nodate">日期暂不可用</span>}
          {fresh && <span className="leaf__journal-badge" role="status">刚写好</span>}
        </header>

        <h3 className="leaf__title">{at ? `${at.getMonth() + 1}月${at.getDate()}日的日记` : "日记"}</h3>

        <div className="leaf__fold" data-open={expanded ? "true" : "false"}>
          <div className="leaf__paper">
            <RuledPaper className="leaf__ruled" />
            <p className="leaf__text">{journal.text}</p>
          </div>
        </div>

        {collapsed && (
          <button type="button" className="btn btn--quiet leaf__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? "收起来" : "展开看全文"}
          </button>
        )}

        {journal.sources.length > 0 && (
          <details className="leaf__summary">
            <summary>写作来源（{journal.sources.length}）</summary>
            <ul className="leaf__journal-sources">
              {journal.sources.map((source) => (
                <li key={source.id}>
                  <p className="leaf__journal-source-title">
                    <span>{SOURCE_KIND[source.type]}</span> · {source.title}
                  </p>
                  <p>{source.text}</p>
                  <time dateTime={source.createdAt}>{new Date(source.createdAt).toLocaleString()}</time>
                  {source.url && <p className="leaf__journal-source-url">来源链接：{source.url}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}

        <footer className="leaf__foot">
          <span>共 {journal.sources.length} 段经历</span>
          {expanded && <span>第 {journal.revision} 版</span>}
        </footer>
      </div>
    </Card>
  );
}
