import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CompanionCorner, setCompanionMood } from "../components/CompanionCorner";
import { PageHeader } from "../components/shell/PageHeader";
import { useMediaQuery } from "../components/chat/useViewport";
import { StatePanel } from "../components/pages/StatePanel";
import { Button, Card, ConfirmDialog } from "../components/ui";
import { toast } from "../components/ui/toast-store";
import { FilterBar } from "../components/memory/FilterBar";
import { MemoryRow } from "../components/memory/MemoryRow";
import { MemoryDialog } from "../components/memory/MemoryDialog";
import { useCharacter } from "../characters";
import { m } from "../i18n";
import { useHubRefresh } from "../lib/useHubRefresh";
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

/** 一页最多几行：桌面 10 行，手机 6 行。 */
const PAGE_WIDE = 10;
const PAGE_NARROW = 6;
/** 撤回窗口（规范 §7.3.5）：吐司显示 5 秒，它在期间不删，一走才真删。 */
const UNDO_MS = 5000;
const FOLD_MS = 240;

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

  /** 还在撤回窗口里的删除：记忆 id → 吐司 id。吐司走了才真删（见 toast-store 的 onDismiss）。 */
  const pending = useRef(new Map<string, number>());
  const foldTimers = useRef(new Map<string, number>());

  const load = useCallback((signal?: AbortSignal) => {
    setError("");
    fetchMemories(signal).then(
      (list) => setEntries(list as MemoryEntryP2[]),
      (cause: unknown) => {
        if (!signal?.aborted) setError(cause instanceof Error ? cause.message : m.memory.page.readFailed);
      },
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    fetchNote(character.id, controller.signal).then(setNote).catch(() => setNote(null));
    return () => controller.abort();
  }, [load, character.id]);

  useHubRefresh(["memory.updated", "diary.updated"], () => load());

  // 离开页面 / 关标签：还在撤回窗口里的那几条立刻提交，别把用户的意图丢掉。
  // 先把它们从 pending 摘掉再收吐司，吐司的 onDismiss 就不会再提交第二次。
  useEffect(() => {
    const waiting = pending.current;
    const flush = () => {
      for (const [id, toastId] of [...waiting]) {
        waiting.delete(id);
        toast.dismiss(toastId);
        void deleteMemory(id).catch(() => undefined);
      }
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
      // 折叠定时器可能还没到点（便签在折叠动画里就被关掉）：先取消，免得它随后又把条目藏起来。
      const folding = foldTimers.current.get(id);
      if (folding) window.clearTimeout(folding);
      foldTimers.current.delete(id);
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
      toast({ title: m.memory.page.forgetFailedTitle, description: m.memory.page.forgetFailedBody, tone: "error" });
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

    // 删除不再另起定时器：跟吐司同生共死。吐司在（含悬停暂停时），「撤回」都还作数；吐司一走才真删。
    const toastId = toast({
      title: m.memory.page.forgottenTitle,
      description: m.memory.page.forgottenBody,
      duration: UNDO_MS,
      onDismiss: () => {
        if (pending.current.delete(entry.id)) void commit(entry.id);
      },
      action: {
        label: m.memory.page.undo,
        onClick: () => {
          if (!pending.current.delete(entry.id)) {
            toast({ title: m.memory.page.tooLateToUndo, tone: "warning" });
            return;
          }
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
        },
      },
    });
    pending.current.set(entry.id, toastId);
  };

  const clearAll = () => {
    setGroup("all");
    setFilters(EMPTY_FILTERS);
    setQuery("");
    setApplied("");
    setPage(0);
  };

  // 搜索 / 筛选没结果，或者点进了一个计数为 0 的分类
  const emptySearch = (searching || group !== "all") && filtered.length === 0;
  const total = alive.length;

  return (
    <div className="page memory-page">
      <div className="memory-page__inner">
        <PageHeader title={m.memory.page.title} />

        {note && (
          <Card className="mnote" padding="md">
            <p className="mnote__label">{m.memory.page.noteLabel(character.name)}</p>
            <p className="mnote__text">{note.text}</p>
          </Card>
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

        {entries === null && !error && <StatePanel kind="loading" title={m.memory.page.loadingTitle} body={m.memory.page.loadingBody} />}

        {error && entries === null && (
          <StatePanel kind="error" title={m.memory.page.errorTitle} body={m.memory.page.errorBody} detail={error}>
            <Button variant="primary" onClick={() => load()}>{m.memory.page.retry}</Button>
          </StatePanel>
        )}

        {entries !== null && total === 0 && (
          <StatePanel kind="empty" title={m.memory.page.emptyTitle} body={m.memory.page.emptyBody}>
            <Link className="ui-btn ui-press ui-focus ui-btn--primary" to="/">{m.memory.page.goChat}</Link>
          </StatePanel>
        )}

        {emptySearch && total > 0 && (
          <StatePanel
            kind="empty"
            icon="bottle"
            title={
              applied.trim()
                ? m.memory.page.noMatch(applied.trim())
                : searching
                  ? m.memory.page.noneFiltered
                  : m.memory.page.noneInCategory
            }
            body={searching ? m.memory.page.tryOtherWord : m.memory.page.tryOtherCategory}
          >
            <Button variant="secondary" onClick={clearAll}>{m.memory.page.clearFilters}</Button>
          </StatePanel>
        )}

        {visible.length > 0 && (
          <>
            <Card className="mlist" padding="none">
              <div className="mlist__head" aria-hidden>
                <span>{m.memory.page.headMemory}</span>
                <span>{m.memory.page.headCategory}</span>
                <span>{m.memory.page.headSource}</span>
                <span>{m.memory.page.headTime}</span>
              </div>
              <ul className="mlist__rows">
                {visible.map((entry) => (
                  <MemoryRow key={entry.id} entry={entry} onOpen={setDetail} forgetting={forgetting.has(entry.id)} />
                ))}
              </ul>
            </Card>

            <nav className="mpager" aria-label={m.memory.page.pagerAria}>
              <Button variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>{m.memory.page.prevPage}</Button>
              <span className="mpager__no" aria-live="polite">
                {m.memory.page.pageOf(current + 1, pageCount)}
              </span>
              <Button variant="secondary" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>{m.memory.page.nextPage}</Button>
            </nav>
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
        title={m.memory.page.confirmTitle}
        description={m.memory.page.confirmBody}
        cancelLabel={m.memory.page.keep}
        confirmLabel={m.memory.page.confirmForget}
        tone="danger"
        onConfirm={() => {
          if (confirming) forget(confirming);
        }}
      />

    </div>
  );
}
