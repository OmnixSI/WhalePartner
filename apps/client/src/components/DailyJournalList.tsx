import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Character } from "../characters";
import { fetchJournalRevisions, fetchJournals, generateJournal, type DailyJournal, type JournalSource } from "../lib/diary";

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SOURCE_LABELS: Record<JournalSource["type"], string> = {
  chat: "聊天", video: "视频", web: "网页", learned: "新发现", reflection: "反思",
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
    <summary>这篇日记参考了 {journal.sources.length} 段经历</summary>
    <ul>{journal.sources.map((source) => <li key={source.id}>
      <span>{SOURCE_LABELS[source.type]} · {timestamp(source.createdAt)} · {source.title}</span>
      {source.messageId && source.sessionId && <button type="button" onClick={() => open(source)}>打开原聊天</button>}
      {source.url && <a href={source.url} target="_blank" rel="noreferrer">查看原内容 ↗</a>}
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
      setError(cause instanceof Error ? cause.message : "读取版本记录失败。");
    }
  };
  return <details className="journal-revisions" onToggle={(event) => { if (event.currentTarget.open && revisions === null) void load(); }}>
    <summary>查看 {journal.revision - 1} 个旧版本</summary>
    {error && <p className="diary-error">{error}</p>}
    {revisions?.filter((revision) => revision.revision !== journal.revision).map((revision) => <article key={revision.revision}>
      <div>第 {revision.revision} 版 · {timestamp(revision.createdAt)}</div>
      <p>{revision.text}</p>
    </article>)}
  </details>;
}

function JournalEntry({ journal, characterId }: { journal: DailyJournal; characterId: string }) {
  return <article className="daily-journal-entry" id={journal.id}>
    <div className="daily-journal-entry__meta"><time dateTime={journal.localDate}>{journal.localDate}</time><span>第 {journal.revision} 版</span></div>
    <p>{journal.text}</p>
    <JournalSources journal={journal} characterId={characterId} />
    <PreviousRevisions journal={journal} />
  </article>;
}

export function DailyJournalList({ character }: { character: Character }) {
  const [journals, setJournals] = useState<DailyJournal[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setJournals(await fetchJournals(character.id, signal));
      if (!signal?.aborted) setError("");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "读取日记失败。");
    }
  }, [character.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => { void load(controller.signal); }, 8000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    const key = `whalepartner:open-journal:${character.id}`;
    const targetId = localStorage.getItem(key);
    if (!targetId) return;
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
    try {
      const journal = await generateJournal(character.id, undefined, Boolean(todayJournal));
      if (!journal) setMessage("今天还没有聊天、视频、网页或反思内容，暂时没有日记可写。");
      else await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成日记失败。");
    } finally {
      setGenerating(false);
    }
  };

  const todayJournal = journals?.find((journal) => journal.localDate === today());
  return <section className="daily-journal card">
    <header className="daily-journal__head">
      <div><h2>今天与{character.name}的日记</h2><p>把聊天、一起看过的内容和她的想法写成当天的一篇日记。</p></div>
      <button className="diary-button" type="button" disabled={generating} onClick={() => void generate()}>
        {generating ? "正在整理今天的经历…" : todayJournal ? "更新今天的日记" : "写今天的日记"}
      </button>
    </header>
    {message && <p className="daily-journal__message" role="status">{message}</p>}
    {error && <p className="diary-error" role="alert">{error}</p>}
    {journals === null && !error && <p className="diary-status">正在读取日记…</p>}
    {journals && journals.length === 0 && <p className="daily-journal__empty">还没有日记。聊过几句后，可以手动写今天的日记；API 也会按计划自动整理。</p>}
    {journals && journals.length > 0 && <div className="daily-journal__list">
      {journals.map((journal) => <JournalEntry key={journal.id} journal={journal} characterId={character.id} />)}
    </div>}
  </section>;
}
