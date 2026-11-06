import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CompanionCorner, setCompanionMood } from "../components/CompanionCorner";
import { ConfirmDialog } from "../components/chat/ConfirmDialog";
import { useMediaQuery } from "../components/chat/useViewport";
import { Tape } from "../components/ink";
import { StateBlock } from "../components/diary/StateBlock";
import { Toast } from "../components/diary/Toast";
import { FilterBar } from "../components/memory/FilterBar";
import { MemoryCard } from "../components/memory/MemoryCard";
import { MemoryDialog } from "../components/memory/MemoryDialog";
import { useCharacter } from "../characters";
import { deleteMemory, fetchMemories, fetchNote, type CharacterNote } from "../lib/memory";
import {
  EMPTY_FILTERS,
  filterActive,
  groupOf,
  isSuperseded,
  type GroupKey,
  type MemoryEntryP2,
  type OwnFilters,
} from "../components/memory/types";
import "../styles/memory.css";

/** 一屏最多几张卡：桌面 3 列 × 3 行，手机 1 列 × 6。 */
const PAGE_WIDE = 9;
const PAGE_NARROW = 6;
/** 撤回窗口（规范 §7.3.5）：5 秒内不删，超时才真删。 */
const UNDO_MS = 5000;
const FOLD_MS = 480;

export function MemoryPage() {
  const character = useCharacter();
  const wide = useMediaQuery("(min-width: 768px)");

  const [entries, setEntries] = useState<MemoryEntryP2[] | null>(null);
  const [note, setNote] = useState<CharacterNote | null>(null);
  const [error, setError] = useState("");

  const [detail, setDetail] = useState<MemoryEntryP2 | null>(null);
  const [confirming, setConfirming] = useState<MemoryEntryP2 | null>(null);

  const [forgetting, setForgetting] = useState<Set<string>>(() => new Set());
  const [gone, setGone] = useState<Set<string>>(() => new Set());

  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [group, setGroup] = useState<GroupKey>("all");
  const [filters, setFilters] = useState<OwnFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);

  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const deleteTimers = useRef(new Map<string, number>());
  const foldTimers = useRef(new Map<string, number>());

  const load = useCallback((signal?: AbortSignal) => {
    setError("");
    fetchMemories(signal).then(
      (list) => setEntries(list as MemoryEntryP2[]),
      (cause: unknown) => {
        if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "读取失败。");
      },
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    fetchNote(character.id, controller.signal).then(setNote).catch(() => setNote(null));
    return () => controller.abort();
  }, [load, character.id]);

  // 离开页面 / 关标签：还没到 5 秒的那几条立刻提交，别把用户的意图丢掉。
  useEffect(() => {
    const timers = deleteTimers.current;
    const flush = () => {
      timers.forEach((timer, id) => {
        window.clearTimeout(timer);
        void deleteMemory(id).catch(() => undefined);
      });
      timers.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
      foldTimers.current.forEach((timer) => window.clearTimeout(timer));
      foldTimers.current.clear();
    };
  }, []);

  useEffect(() => {
    setPage(0);
  }, [group, applied, filters]);

  const alive = useMemo(() => (entries ?? []).filter((entry) => !gone.has(entry.id)), [entries, gone]);

  const counts = useMemo(() => {
    const out = { all: 0, about: 0, together: 0, learned: 0, surf: 0, now: 0 } as Record<GroupKey, number>;
    for (const entry of alive) {
      out.all += 1;
      out[groupOf(entry)] += 1;
    }
    return out;
  }, [alive]);

  const searching = Boolean(applied.trim()) || filterActive(filters);

  const filtered = useMemo(() => {
    const needle = applied.trim().toLowerCase();
    return alive.filter((entry) => {
      if (group !== "all" && groupOf(entry) !== group) return false;
      if (filters.era === "past" && !isSuperseded(entry)) return false;
      if (filters.era === "current" && isSuperseded(entry)) return false;
      if (filters.from || filters.to) {
        const at = entry.createdAt ? new Date(entry.createdAt) : null;
        if (!at || Number.isNaN(at.getTime())) return false;
        if (filters.from && at < filters.from) return false;
        if (filters.to && at > new Date(filters.to.getFullYear(), filters.to.getMonth(), filters.to.getDate(), 23, 59, 59)) return false;
      }
      if (needle) {
        const haystack = `${entry.text} ${entry.title ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [alive, group, filters, applied]);

  const pageSize = wide ? PAGE_WIDE : PAGE_NARROW;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize);

  const commit = useCallback(async (id: string) => {
    deleteTimers.current.delete(id);
    try {
      await deleteMemory(id);
      setEntries((prev) => prev?.filter((entry) => entry.id !== id) ?? null);
      setGone((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      // 失败：卡片弹回原位 + 错误便签（规范 §7.3.5 第 4 步）。
      setGone((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setForgetting((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setToast({ text: "没能忘掉，再试一次？" });
    }
  }, []);

  const forget = (entry: MemoryEntryP2) => {
    setConfirming(null);
    setDetail(null);
    setForgetting((prev) => new Set(prev).add(entry.id));
    setCompanionMood("sorry", { ttl: 2000 });

    const fold = window.setTimeout(() => {
      foldTimers.current.delete(entry.id);
      setGone((prev) => new Set(prev).add(entry.id));
      setForgetting((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }, FOLD_MS);
    foldTimers.current.set(entry.id, fold);

    const timer = window.setTimeout(() => void commit(entry.id), UNDO_MS);
    deleteTimers.current.set(entry.id, timer);

    setToast({
      text: "已经忘掉了。",
      undo: () => {
        const pending = deleteTimers.current.get(entry.id);
        if (pending) window.clearTimeout(pending);
        deleteTimers.current.delete(entry.id);
        const folding = foldTimers.current.get(entry.id);
        if (folding) window.clearTimeout(folding);
        foldTimers.current.delete(entry.id);
        setForgetting((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
        setGone((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
        setToast(null);
      },
    });
  };

  const clearAll = () => {
    setGroup("all");
    setFilters(EMPTY_FILTERS);
    setQuery("");
    setApplied("");
    setPage(0);
  };

  const emptySearch = searching && filtered.length === 0;
  const total = alive.length;

  return (
    <div className="page memory-page">
      <div className="memory-page__inner">
        <header className="memory-page__head">
          <h1 className="memory-page__title">她记得的事</h1>
          {entries !== null && <p className="memory-page__count">已收好 {total} 件</p>}
        </header>

        <div className={`memory-page__top${note ? "" : " memory-page__top--bare"}`}>
          {note && (
            <figure className="nslip">
              <Tape color="c" w={56} h={18} angle={-4} className="nslip__tape" />
              <figcaption className="nslip__label">{character.name}的近况</figcaption>
              <blockquote className="nslip__text">{note.text}</blockquote>
            </figure>
          )}

          {(entries !== null || !error) && (
          <FilterBar
            query={query}
            onQuery={setQuery}
            onSearch={() => {
              setApplied(query);
              setPage(0);
            }}
            onClearSearch={() => {
              setQuery("");
              setApplied("");
            }}
            group={group}
            onGroup={setGroup}
            filters={filters}
            onFilters={setFilters}
            onClearAll={clearAll}
            resultCount={searching ? filtered.length : null}
            counts={counts}
          />
          )}
        </div>

        {entries === null && !error && <StateBlock kind="loading" title="她在翻小本子…" body="马上就好。" />}

        {error && entries === null && (
          <StateBlock
            kind="error"
            title="翻不开了"
            body="网络好像不太好。"
            detail={error}
            action={{ label: "再试一次", onClick: () => load() }}
          />
        )}

        {entries !== null && total === 0 && (
          <StateBlock
            kind="empty"
            title="她还在认识你"
            body="多聊几句，她记住的事就会放在这儿。"
            mood="hold"
          >
            <Link className="btn btn--secondary memory-page__gochat" to="/">
              去和她聊聊
            </Link>
          </StateBlock>
        )}

        {emptySearch && total > 0 && (
          <StateBlock
            kind="empty"
            title={applied.trim() ? `没找到带「${applied.trim()}」的纸条` : "这几种筛选下，暂时没有纸条"}
            body="换个词试试，或者把筛选清掉。"
            action={{ label: "清掉筛选", onClick: clearAll }}
          />
        )}

        {visible.length > 0 && (
          <>
            <ul className="mgrid">
              {visible.map((entry) => (
                <MemoryCard key={entry.id} entry={entry} onOpen={setDetail} forgetting={forgetting.has(entry.id)} />
              ))}
            </ul>

            <div className="mpager">
              <button type="button" className="mpager__step" disabled={current === 0} onClick={() => setPage(current - 1)}>
                <span aria-hidden>‹</span> 上一页
              </button>
              <span className="mpager__no" aria-live="polite">
                第 {current + 1} / {pageCount} 页
              </span>
              <button
                type="button"
                className="mpager__step"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              >
                下一页 <span aria-hidden>›</span>
              </button>
            </div>
          </>
        )}

        {error && entries !== null && (
          <p className="memory-page__opnote" role="alert">
            {error}
          </p>
        )}
      </div>

      <CompanionCorner mood="hold" />

      <MemoryDialog entry={detail} onClose={() => setDetail(null)} onForget={setConfirming} />

      <ConfirmDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="要忘掉这条吗？"
        body="忘掉以后，她就不会再提这件事了——这条记忆会从她的小本子里消失，日记和聊天记录不受影响。"
        cancelLabel="先留着"
        confirmLabel="忘掉这条"
        danger
        onConfirm={() => {
          if (confirming) forget(confirming);
        }}
      />

      <Toast
        open={Boolean(toast)}
        text={toast?.text ?? ""}
        actionLabel={toast?.undo ? "撤回" : undefined}
        onAction={toast?.undo}
        onClose={() => setToast(null)}
        duration={toast?.undo ? UNDO_MS : 3600}
        tone={toast?.undo ? "plain" : "alert"}
      />
    </div>
  );
}
