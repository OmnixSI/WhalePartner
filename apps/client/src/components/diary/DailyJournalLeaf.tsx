import { useId, useState } from "react";
import type { DailyJournal } from "../../lib/diary";
import { Card } from "../ui/Card";
import { DateStamp } from "./DateStamp";
import { RuledPaper } from "./RuledPaper";
import { journalDate } from "./types";
import { m, locale } from "../../i18n";

type Props = {
  journal: DailyJournal;
  collapsed: boolean;
  fresh?: boolean;
};

const SOURCE_KIND: Record<DailyJournal["sources"][number]["type"], string> = {
  chat: m.diary.journalLeaf.sourceKind.chat,
  video: m.diary.journalLeaf.sourceKind.video,
  web: m.diary.journalLeaf.sourceKind.web,
  learned: m.diary.journalLeaf.sourceKind.learned,
  reflection: m.diary.journalLeaf.sourceKind.reflection,
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
          {at ? <DateStamp at={at} id={`${stampId}-journal`} /> : <span className="leaf__nodate">{m.diary.journalLeaf.noDate}</span>}
          {fresh && <span className="leaf__journal-badge" role="status">{m.diary.journalLeaf.fresh}</span>}
        </header>

        <h3 className="leaf__title">{at ? m.diary.journalLeaf.title(at) : m.diary.journalLeaf.titleFallback}</h3>

        <div className="leaf__fold" data-open={expanded ? "true" : "false"}>
          <div className="leaf__paper">
            <RuledPaper className="leaf__ruled" />
            <p className="leaf__text">{journal.text}</p>
          </div>
        </div>

        {collapsed && (
          <button type="button" className="btn btn--quiet leaf__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? m.diary.leaf.collapse : m.diary.leaf.expand}
          </button>
        )}

        {journal.sources.length > 0 && (
          <details className="leaf__summary">
            <summary>{m.diary.journalLeaf.sourcesSummary(journal.sources.length)}</summary>
            <ul className="leaf__journal-sources">
              {journal.sources.map((source) => (
                <li key={source.id}>
                  <p className="leaf__journal-source-title">
                    <span>{SOURCE_KIND[source.type]}</span> · {source.title}
                  </p>
                  <p>{source.text}</p>
                  <time dateTime={source.createdAt}>{new Date(source.createdAt).toLocaleString(locale)}</time>
                  {source.url && <p className="leaf__journal-source-url">{m.diary.journalLeaf.sourceUrl(source.url)}</p>}
                </li>
              ))}
            </ul>
          </details>
        )}

        <footer className="leaf__foot">
          <span>{m.diary.journalLeaf.count(journal.sources.length)}</span>
          {expanded && <span>{m.diary.journalLeaf.version(journal.revision)}</span>}
        </footer>
      </div>
    </Card>
  );
}
