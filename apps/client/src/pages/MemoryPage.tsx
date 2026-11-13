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
      toast({ title: "没能忘掉", description: "再试一次？", tone: "error" });
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
      title: "已经忘掉了",
      description: "5 秒内可以撤回。",
      duration: UNDO_MS,
      onDismiss: () => {
        if (pending.current.delete(entry.id)) void commit(entry.id);
      },
      action: {
        label: "撤回",
        onClick: () => {
          if (!pending.current.delete(entry.id)) {
            toast({ title: "已经删掉了，撤不回", tone: "warning" });
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
        <PageHeader
          eyebrow="手帐 · 记忆"
          title="她记得的事"
          lead={
            entries === null
              ? "正在翻她的本子…"
              : total > 0
                ? `已收好 ${total} 条，点开一条看详情，也可以让她忘掉。`
                : "还没有记下的事。聊得多了，她会自己记。"
          }
        />

        {note && (
          <Card className="mnote" padding="md">
            <p className="mnote__label">{character.name}的近况</p>
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

        {entries === null && !error && <StatePanel kind="loading" title="她在翻小本子…" body="马上就好。" />}

        {error && entries === null && (
          <StatePanel kind="error" title="翻不开了" body="网络好像不太好。" detail={error}>
            <Button variant="primary" onClick={() => load()}>再试一次</Button>
          </StatePanel>
        )}

        {entries !== null && total === 0 && (
          <StatePanel kind="empty" title="她还在认识你" body="多聊几句，她记住的事就会放在这儿。">
            <Link className="ui-btn ui-press ui-focus ui-btn--primary" to="/">去和她聊聊</Link>
          </StatePanel>
        )}

        {emptySearch && total > 0 && (
          <StatePanel
            kind="empty"
            icon="bottle"
            title={
              applied.trim()
                ? `没找到带「${applied.trim()}」的记忆`
                : searching
                  ? "这几种筛选下，暂时没有记忆"
                  : "这个分类还没有记忆"
            }
            body={searching ? "换个词试试，或者把筛选清掉。" : "换个分类看看，或者回到全部。"}
          >
            <Button variant="secondary" onClick={clearAll}>清掉筛选</Button>
          </StatePanel>
        )}

        {visible.length > 0 && (
          <>
            <Card className="mlist" padding="none">
              <div className="mlist__head" aria-hidden>
                <span>记忆</span>
                <span>分类</span>
                <span>来源</span>
                <span>时间</span>
              </div>
              <ul className="mlist__rows">
                {visible.map((entry) => (
                  <MemoryRow key={entry.id} entry={entry} onOpen={setDetail} forgetting={forgetting.has(entry.id)} />
                ))}
              </ul>
            </Card>

            <nav className="mpager" aria-label="翻页">
              <Button variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</Button>
              <span className="mpager__no" aria-live="polite">
                第 {current + 1} / {pageCount} 页
              </span>
              <Button variant="secondary" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>下一页</Button>
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
        title="要忘掉这条吗？"
        description="忘掉以后，她就不会再提这件事了——这条记忆会从她的小本子里消失，日记和聊天记录不受影响。"
        cancelLabel="先留着"
        confirmLabel="忘掉这条"
        tone="danger"
        onConfirm={() => {
          if (confirming) forget(confirming);
        }}
      />

    </div>
  );
}
