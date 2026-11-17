import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Character } from "../characters";
import { m, locale } from "../i18n";
import { fetchJournalRevisions, fetchJournals, generateJournal, type DailyJournal, type DailyJournalPage, type JournalSource } from "../lib/diary";

type JournalView = "week" | "month" | "year";
const PAGE_SIZE = 30;

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function today() {
  return formatDate(new Date());
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateFromPendingLink(characterId: string) {
  const value = localStorage.getItem(`whalepartner:open-journal:${characterId}`);
  const match = value && new RegExp(`^journal:${characterId}:(\\d{4}-\\d{2}-\\d{2})$`, "u").exec(value);
  return match?.[1];
}

function movePeriod(value: string, direction: number, view: JournalView) {
  const date = parseDate(value);
  if (view === "week") date.setDate(date.getDate() + direction * 7);
  else if (view === "month") return formatDate(new Date(date.getFullYear(), date.getMonth() + direction, 1, 12));
  else return formatDate(new Date(date.getFullYear() + direction, date.getMonth(), 1, 12));
  return formatDate(date);
}

function periodRange(value: string, view: JournalView) {
  const date = parseDate(value);
  if (view === "week") {
    const start = new Date(date);
    start.setDate(date.getDate() - (date.getDay() + 6) % 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: formatDate(start), to: formatDate(end) };
  }
  if (view === "month") {
    return {
      from: formatDate(new Date(date.getFullYear(), date.getMonth(), 1, 12)),
      to: formatDate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)),
    };
  }
  return {
    from: formatDate(new Date(date.getFullYear(), 0, 1, 12)),
    to: formatDate(new Date(date.getFullYear(), 11, 31, 12)),
  };
}

function periodLabel(value: string, view: JournalView) {
  const date = parseDate(value);
  if (view === "year") return m.diary.journalList.year(date.getFullYear());
  if (view === "month") return m.diary.journalList.yearMonth(date);
  const { from, to } = periodRange(value, view);
  return m.diary.journalList.weekRange(parseDate(from), parseDate(to));
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SOURCE_LABELS: Record<JournalSource["type"], string> = {
  chat: m.diary.journalList.sourceLabels.chat,
  video: m.diary.journalList.sourceLabels.video,
  web: m.diary.journalList.sourceLabels.web,
  learned: m.diary.journalList.sourceLabels.learned,
  reflection: m.diary.journalList.sourceLabels.reflection,
};

function JournalSources({ journal, characterId }: { journal: DailyJournal; characterId: string }) {
  const navigate = useNavigate();
  const open = (source: JournalSource) => {
    if (!source.sessionId) return;
    localStorage.setItem(`whalepartner:session:${characterId}`, source.sessionId);
    if (source.messageId) {
      localStorage.setItem(`whalepartner:open-session:${characterId}`, source.sessionId);
      localStorage.setItem(`whalepartner:open-message:${characterId}`, String(source.messageId));
    }
    navigate("/");
  };
  return <details className="journal-sources">
    <summary>{m.diary.journalList.sourcesSummary(journal.sources.length)}</summary>
    <ul>{journal.sources.map((source) => <li key={source.id}>
      <span>{SOURCE_LABELS[source.type]} · {timestamp(source.createdAt)} · {source.title}</span>
      {source.messageId && source.sessionId && <button type="button" onClick={() => open(source)}>{m.diary.journalList.openChat}</button>}
      {source.url && <a href={source.url} target="_blank" rel="noreferrer">{m.diary.journalList.viewOriginal}</a>}
    </li>)}</ul>
  </details>;
}

function PreviousRevisions({ journal }: { journal: DailyJournal }) {
  const [revisions, setRevisions] = useState<DailyJournal[] | null>(null);
  const [error, setError] = useState("");
  if (journal.revision <= 1) return null;
  const load = async () => {
    try {
      setRevisions(await fetchJournalRevisions(journal.id));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.diary.journalList.revisionsFailed);
    }
  };
  return <details className="journal-revisions" onToggle={(event) => { if (event.currentTarget.open && revisions === null) void load(); }}>
    <summary>{m.diary.journalList.oldVersions(journal.revision - 1)}</summary>
    {error && <p className="diary-error">{error}</p>}
    {revisions?.filter((revision) => revision.revision !== journal.revision).map((revision) => <article key={revision.revision}>
      <div>{m.diary.journalList.version(revision.revision)} · {timestamp(revision.createdAt)}</div>
      <p>{revision.text}</p>
    </article>)}
  </details>;
}

function JournalEntry({ journal, characterId }: { journal: DailyJournal; characterId: string }) {
  return <article className="daily-journal-entry" id={journal.id}>
    <div className="daily-journal-entry__meta"><time dateTime={journal.localDate}>{journal.localDate}</time><span>{m.diary.journalList.version(journal.revision)}</span></div>
    <p>{journal.text}</p>
    <JournalSources journal={journal} characterId={characterId} />
    <PreviousRevisions journal={journal} />
  </article>;
}

export function DailyJournalList({ character }: { character: Character }) {
  const [view, setView] = useState<JournalView>("month");
  const [cursor, setCursor] = useState(() => dateFromPendingLink(character.id) ?? today());
  const [page, setPage] = useState(0);
  const [journals, setJournals] = useState<DailyJournalPage | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const range = useMemo(() => periodRange(cursor, view), [cursor, view]);

  useEffect(() => {
    const target = dateFromPendingLink(character.id);
    if (target) setView("week");
    setCursor(target ?? today());
    setPage(0);
  }, [character.id]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await fetchJournals(character.id, {
        ...range,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }, signal);
      if (!signal?.aborted) {
        setJournals(result);
        setError("");
      }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : m.diary.errors.readFailed);
    }
  }, [character.id, page, range]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const currentDate = today();
    const includesToday = range.from <= currentDate && currentDate <= range.to;
    const timer = includesToday ? window.setInterval(() => { void load(controller.signal); }, 30000) : undefined;
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [load, range]);

  useEffect(() => {
    if (!journals) return;
    const lastPage = Math.max(0, Math.ceil(journals.total / PAGE_SIZE) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [journals, page]);

  useEffect(() => {
    const key = `whalepartner:open-journal:${character.id}`;
    const targetId = localStorage.getItem(key);
    if (!targetId || !journals) return;
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      localStorage.removeItem(key);
    }
  }, [character.id, journals]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setError("");
    setMessage("");
    const date = today();
    setCursor(date);
    setPage(0);
    try {
      const existing = await fetchJournals(character.id, { from: date, to: date, limit: 1, offset: 0 });
      const journal = await generateJournal(character.id, date, existing.items.length > 0);
      if (!journal) setMessage(m.diary.journalList.noMaterialToday);
      else setMessage(m.diary.journalList.updatedToday);
      const currentRange = periodRange(date, view);
      setJournals(await fetchJournals(character.id, { ...currentRange, limit: PAGE_SIZE, offset: 0 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.diary.journalList.generateFailed);
    } finally {
      setGenerating(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil((journals?.total ?? 0) / PAGE_SIZE));
  return <section className="daily-journal card">
    <header className="daily-journal__head">
      <div><h2>{m.diary.journalList.title(character.name)}</h2></div>
      <button className="diary-button" type="button" disabled={generating} onClick={() => void generate()}>
        {generating ? m.diary.journalList.generating : m.diary.journalList.writeToday}
      </button>
    </header>
    <div className="journal-browser" aria-label={m.diary.journalList.browserAria}>
      <div className="journal-browser__modes" role="group" aria-label={m.diary.journalList.rangeAria}>
        {([ ["week", m.diary.journalList.modes.week], ["month", m.diary.journalList.modes.month], ["year", m.diary.journalList.modes.year] ] as const).map(([id, label]) => <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => { setView(id); setPage(0); }}
        >{label}</button>)}
      </div>
      <button className="journal-browser__step" type="button" aria-label={m.diary.journalList.prevPeriod} onClick={() => { setCursor((value) => movePeriod(value, -1, view)); setPage(0); }}>‹</button>
      <strong>{periodLabel(cursor, view)}</strong>
      <button className="journal-browser__step" type="button" aria-label={m.diary.journalList.nextPeriod} onClick={() => { setCursor((value) => movePeriod(value, 1, view)); setPage(0); }}>›</button>
      <label className="sr-only" htmlFor="journal-date">{m.diary.journalList.pickDate}</label>
      <input className="journal-browser__date" id="journal-date" type="date" value={cursor} onChange={(event) => { if (event.target.value) { setCursor(event.target.value); setPage(0); } }} />
      <button className="journal-browser__today" type="button" onClick={() => { setCursor(today()); setPage(0); }}>{m.diary.journalList.today}</button>
    </div>
    {message && <p className="daily-journal__message" role="status">{message}</p>}
    {error && <p className="diary-error" role="alert">{error}</p>}
    {journals === null && !error && <p className="diary-status">{m.diary.journalList.loading}</p>}
    {journals && journals.total === 0 && <p className="daily-journal__empty">{m.diary.journalList.empty}</p>}
    {journals && journals.total > 0 && <>
      <div className="daily-journal__list">
        {journals.items.map((journal) => <JournalEntry key={journal.id} journal={journal} characterId={character.id} />)}
      </div>
      <nav className="journal-pagination" aria-label={m.diary.journalList.paginationAria}>
        <button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>{m.diary.journalList.prevPage}</button>
        <span>{m.diary.journalList.pageStatus(journals.total, page + 1, totalPages)}</span>
        <button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}>{m.diary.journalList.nextPage}</button>
      </nav>
    </>}
  </section>;
}
