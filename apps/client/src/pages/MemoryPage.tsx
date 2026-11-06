import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CHARACTERS, setCharacter, useCharacter, type CharacterId } from "../characters";
import { deleteMemory, fetchMemoryExplorer, fetchNote, type CharacterNote, type MemoryCategory, type MemoryExplorerFilters, type MemoryExplorerItem, type MemoryExplorerResult } from "../lib/memory";

const PAGE_SIZE = 30;
const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  all: "全部", fact: "关于你", conversation: "聊天原文", video: "视频", web: "网页", diary: "日记", learned: "她学到的", reflection: "反思",
};
const CATEGORY_GROUPS: Array<{ title: string; categories: Array<Exclude<MemoryCategory, "all">> }> = [
  { title: "关于你", categories: ["fact"] },
  { title: "共同经历", categories: ["conversation", "video", "web", "diary"] },
  { title: "她学到的", categories: ["learned"] },
  { title: "角色近况", categories: ["reflection"] },
];

function when(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function groupByDay(items: MemoryExplorerItem[]) {
  const groups = new Map<string, MemoryExplorerItem[]>();
  for (const item of items) {
    const day = new Date(item.createdAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return [...groups.entries()];
}

function MemoryRow({ item, onOpen, onOpenJournal, onForget }: {
  item: MemoryExplorerItem;
  onOpen: (character: CharacterId, sessionId: string, messageId?: number) => void;
  onOpenJournal: (item: MemoryExplorerItem) => void;
  onForget: (item: MemoryExplorerItem) => void;
}) {
  const messageId = item.type === "message" ? Number(item.id.slice("message:".length)) : item.messageId;
  const firstSource = item.sources?.[0];
  const hasSource = Boolean(item.sessionId || firstSource?.sessionId);
  const canForget = item.type === "fact" || item.type === "experience";

  return (
    <article className="memory-entry">
      <div className="memory-entry__meta">
        <span>{CATEGORY_LABELS[item.category]}{item.role ? ` · ${item.role === "user" ? "你" : "她"}` : ""}</span>
        <time dateTime={item.createdAt}>{when(item.createdAt)}</time>
      </div>
      <h3 className="memory-entry__title">{item.title}</h3>
      <p className="memory-entry__text">{item.text}</p>
      {item.status && <p className="memory-entry__state">{item.status === "active" ? "当前记忆" : `历史记忆 · ${when(item.validFrom ?? item.createdAt)} 至 ${item.validTo ? when(item.validTo) : "后来"}`}</p>}
      {item.sessionTitle && <p className="memory-entry__source">来自对话：{item.sessionTitle}</p>}
      {item.sourceMissing && <p className="memory-entry__source">来源聊天原文已不可用，保留的资料内容仍可查看。</p>}
      {item.sources && item.sources.length > 0 && <details className="memory-entry__sources">
        <summary>查看 {item.sources.length} 条原话来源</summary>
        {item.sources.map((source) => <blockquote className="memory-entry__quote" key={`${source.messageId}:${source.sessionId}`}>
          <p>「{source.quote}」</p>
          <small>{when(source.createdAt)}</small>
          <button type="button" onClick={() => onOpen(source.character as CharacterId, source.sessionId, source.messageId)}>打开原话</button>
        </blockquote>)}
      </details>}
      {item.url && <a className="memory-entry__url" href={item.url} target="_blank" rel="noreferrer">打开原内容 ↗</a>}
      <div className="memory-entry__actions">
        {hasSource && <button type="button" onClick={() => onOpen((firstSource?.character ?? item.character) as CharacterId, firstSource?.sessionId ?? item.sessionId!, messageId ?? firstSource?.messageId)}>打开原聊天</button>}
        {item.category === "diary" && item.sourceId?.startsWith("journal:") && <button type="button" onClick={() => onOpenJournal(item)}>打开这篇日记</button>}
        {canForget && <button className="link-danger" type="button" onClick={() => onForget(item)}>忘掉这条记忆</button>}
      </div>
    </article>
  );
}

export function MemoryPage() {
  const character = useCharacter();
  const navigate = useNavigate();
  const [result, setResult] = useState<MemoryExplorerResult | null>(null);
  const [note, setNote] = useState<CharacterNote | null>(null);
  const [queryDraft, setQueryDraft] = useState("");
  const [filters, setFilters] = useState<MemoryExplorerFilters>({ character: character.id, category: "all", status: "all", role: "all", page: 1, pageSize: PAGE_SIZE });
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [error, setError] = useState("");
  const selectedCharacter = CHARACTERS.find((item) => item.id === filters.character) ?? character;

  const load = useCallback((signal?: AbortSignal) => {
    setError("");
    fetchMemoryExplorer(filters, signal).then(setResult, (cause: unknown) => {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "记忆读取失败。");
    });
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!result || result.page !== filters.page || result.total === 0) return;
    const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
    if (filters.page > lastPage) setFilters((current) => ({ ...current, page: lastPage }));
  }, [filters.page, result]);

  useEffect(() => {
    const controller = new AbortController();
    fetchNote(filters.character, controller.signal).then(setNote);
    return () => controller.abort();
  }, [filters.character]);

  const update = (change: Partial<MemoryExplorerFilters>) => setFilters((current) => ({
    ...current,
    ...change,
    ...(change.category && change.category !== "fact" ? { status: "all" } : {}),
    page: 1,
  }));
  const openSession = (sourceCharacter: CharacterId, sessionId: string, messageId?: number) => {
    setCharacter(sourceCharacter);
    localStorage.setItem(`whalepartner:session:${sourceCharacter}`, sessionId);
    if (messageId) {
      localStorage.setItem(`whalepartner:open-session:${sourceCharacter}`, sessionId);
      localStorage.setItem(`whalepartner:open-message:${sourceCharacter}`, String(messageId));
    }
    navigate("/");
  };

  const openJournal = (item: MemoryExplorerItem) => {
    if (!item.sourceId?.startsWith("journal:")) return;
    setCharacter(item.character as CharacterId);
    localStorage.setItem(`whalepartner:open-journal:${item.character}`, item.sourceId);
    navigate("/diary");
  };

  const forget = async (item: MemoryExplorerItem) => {
    const id = item.type === "fact"
      ? `local:${item.id.slice("fact:".length)}`
      : `local-exp:${item.id.slice("experience:".length)}`;
    if (!window.confirm("从长期记忆中忘掉这条内容？聊天原文仍保留，可通过删除整段对话清除。")) return;
    try {
      await deleteMemory(id);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除记忆失败。");
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update({ query: queryDraft.trim() || undefined });
  };
  const activeFilterCount = [filters.from, filters.to, filters.role !== "all", filters.status !== "all"].filter(Boolean).length;

  return (
    <div className="page">
      <div className="page__inner memory-page">
        <header>
          <h1 className="page__title">她记得的事</h1>
        </header>

        {note && <section className="card memory-note"><h2>{selectedCharacter.name}的近况</h2><p className="note">{note.text}</p></section>}

        <form className="memory-search" onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="memory-search">搜索聊天、事实和经历</label>
          <input id="memory-search" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="搜索你们聊过的话、看过的内容…" />
          <button className="diary-button" type="submit">搜索</button>
        </form>

        <div className="memory-tools">
          <label className="memory-category">
            <span>分类</span>
            <select value={filters.category} onChange={(event) => update({ category: event.target.value as MemoryCategory })}>
              <option value="all">全部 · {result?.total.toLocaleString("zh-CN") ?? "—"}</option>
              {CATEGORY_GROUPS.map((group) => <optgroup key={group.title} label={group.title}>
                {group.categories.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]} · {result?.counts[category] ?? "—"}</option>)}
              </optgroup>)}
            </select>
          </label>
          <details className="memory-filter-panel">
            <summary>筛选{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}</summary>
            <div className="memory-filters">
          <label>角色 <select value={filters.character} onChange={(event) => update({ character: event.target.value })}>
            {CHARACTERS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>从 <input type="date" value={fromDate} onChange={(event) => {
            const value = event.target.value;
            setFromDate(value);
            update({ from: value || undefined });
          }} /></label>
          <label>到 <input type="date" value={toDate} onChange={(event) => {
            const value = event.target.value;
            setToDate(value);
            update({ to: value ? `${value}` : undefined });
          }} /></label>
          <label>聊天发言 <select value={filters.role} onChange={(event) => update({ role: event.target.value as MemoryExplorerFilters["role"] })}>
            <option value="all">全部</option><option value="user">我说的</option><option value="assistant">她说的</option>
          </select></label>
          {filters.category === "fact" && <label>事实状态 <select value={filters.status} onChange={(event) => update({ status: event.target.value as MemoryExplorerFilters["status"] })}>
            <option value="all">当前和历史</option><option value="current">当前</option><option value="historical">历史</option>
          </select></label>}
          {(filters.query || filters.from || filters.to || filters.role !== "all" || filters.status !== "all") && <button type="button" onClick={() => {
            setQueryDraft(""); setFromDate(""); setToDate("");
            setFilters({ character: filters.character, category: filters.category, status: "all", role: "all", page: 1, pageSize: PAGE_SIZE });
          }}>清除筛选</button>}
            </div>
          </details>
        </div>

        {error && <div className="card diary-error-card" role="alert"><h3>记忆读取失败</h3><p>{error}</p><button className="diary-button diary-button--quiet" type="button" onClick={() => load()}>重试</button></div>}
        {!result && !error && <div className="card"><p>正在翻她的小本子…</p></div>}
        {result && result.total === 0 && <div className="card empty"><h3>这里还没有记录</h3><p>试试其他分类或时间范围。聊天原文会在发送后立即保存在本机。</p></div>}

        {result && result.total > 0 && <>
          <div className="memory-result-count">共找到 {result.total.toLocaleString("zh-CN")} 条记录</div>
          <section className="memory-timeline" aria-label="记忆时间线">
            {groupByDay(result.items).map(([day, items]) => <section className="memory-day" key={day}>
              <h2>{day}</h2>
              {items.map((item) => <MemoryRow key={`${item.type}:${item.id}`} item={item} onOpen={openSession} onOpenJournal={openJournal} onForget={forget} />)}
            </section>)}
          </section>
          <nav className="memory-pagination" aria-label="记忆分页">
            <button type="button" disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>上一页</button>
            <span>第 {result.page} 页 / 共 {Math.max(1, Math.ceil(result.total / result.pageSize))} 页</span>
            <button type="button" disabled={result.page * result.pageSize >= result.total} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>下一页</button>
          </nav>
        </>}
      </div>
    </div>
  );
}
