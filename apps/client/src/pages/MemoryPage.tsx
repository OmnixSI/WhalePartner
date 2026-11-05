import { useCallback, useEffect, useState } from "react";
import { useCharacter } from "../characters";
import { deleteMemory, fetchMemories, fetchNote, type CharacterNote, type MemoryEntry } from "../lib/memory";

function when(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function Entry({ entry, onDelete }: { entry: MemoryEntry; onDelete: (id: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [lead, ...rest] = entry.text.split("\n");
  const learned = entry.source === "learned";
  return (
    <li className="memory">
      <div className="memory__body">
        <div className="memory__text">{learned ? entry.text : entry.kind === "experience" ? `《${entry.title ?? lead}》` : entry.text}</div>
        {entry.kind === "experience" && !learned && <div className="memory__sub">{(entry.title ? entry.text.slice(entry.title.length).trim() : rest.join(" ")) || lead}</div>}
        {learned && entry.title && <div className="memory__sub">{entry.title}</div>}
        <div className="memory__meta">{when(entry.createdAt)}</div>
      </div>
      <button
        className={`memory__del${asking ? " is-asking" : ""}`}
        onClick={() => (asking ? onDelete(entry.id) : setAsking(true))}
        onBlur={() => setAsking(false)}
        aria-label={asking ? "确认让她忘掉这条" : "让她忘掉这条"}
      >
        {asking ? "确认忘掉" : "忘掉"}
      </button>
    </li>
  );
}

/** 她记得的事：用户的事实（可查看、可删除）和她看过的内容。 */
export function MemoryPage() {
  const character = useCharacter();
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [note, setNote] = useState<CharacterNote | null>(null);
  const [error, setError] = useState("");

  const load = useCallback((signal?: AbortSignal) => {
    setError("");
    fetchMemories(signal).then(setEntries, (e: unknown) => {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : "读取失败");
    });
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    fetchNote(character.id, ctrl.signal).then(setNote);
    return () => ctrl.abort();
  }, [load, character.id]);

  const remove = async (id: string) => {
    try {
      await deleteMemory(id);
      setEntries((prev) => prev?.filter((e) => e.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const facts = entries?.filter((e) => e.kind === "fact") ?? [];
  const learned = entries?.filter((e) => e.kind === "experience" && e.source === "learned") ?? [];
  const experiences = entries?.filter((e) => e.kind === "experience" && e.source !== "learned") ?? [];

  return (
    <div className="page">
      <div className="page__inner">
        <header>
          <h1 className="page__title">她记得的事</h1>
          <p className="page__lead">你说过的话、重要的日子和她看过的内容。你可以随时查看，也可以让她忘掉。</p>
        </header>

        {error && (
          <div className="card diary-error-card" role="alert">
            <h3>读取失败</h3>
            <p>{error}</p>
            <button className="diary-button diary-button--quiet" onClick={() => load()}>重试</button>
          </div>
        )}
        {entries === null && !error && <div className="card"><p>正在翻她的小本子…</p></div>}
        {entries !== null && entries.length === 0 && (
          <div className="card empty">
            <h3>记忆还是空的</h3>
            <p>多聊几句，她就会开始记住你。聊完后她需要几秒钟整理，再刷新这里。</p>
          </div>
        )}
        {note && (
          <section className="card">
            <h3>{character.name}的近况</h3>
            <p className="note">{note.text}</p>
          </section>
        )}
        {facts.length > 0 && (
          <section className="card">
            <h3>关于你</h3>
            <ul className="memories">{facts.map((e) => <Entry key={e.id} entry={e} onDelete={remove} />)}</ul>
          </section>
        )}
        {learned.length > 0 && (
          <section className="card">
            <h3>她学到的</h3>
            <ul className="memories">{learned.map((e) => <Entry key={e.id} entry={e} onDelete={remove} />)}</ul>
          </section>
        )}
        {experiences.length > 0 && (
          <section className="card">
            <h3>她看过的</h3>
            <ul className="memories">{experiences.map((e) => <Entry key={e.id} entry={e} onDelete={remove} />)}</ul>
          </section>
        )}
      </div>
    </div>
  );
}
