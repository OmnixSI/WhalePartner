import { useCallback, useEffect, useState } from "react";
import { fetchDiary, fetchJournals, type DailyJournal } from "../../lib/diary";
import type { CharacterId } from "../../characters";
import type { DiaryItemP2 } from "./types";

type DateRange = { from: string; to: string };

export function useDiaryPageData(character: CharacterId, range: DateRange) {
  const rangeKey = `${range.from}:${range.to}`;
  const [items, setItems] = useState<DiaryItemP2[] | null>(null);
  const [journals, setJournals] = useState<DailyJournal[] | null>(null);
  const [loadedRange, setLoadedRange] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [videoItems, journalPage] = await Promise.all([
        fetchDiary(signal),
        fetchJournals(character, { ...range, limit: 366, offset: 0 }, signal),
      ]);
      if (signal?.aborted) return;
      setItems(videoItems as DiaryItemP2[]);
      setJournals(deduplicateJournals(journalPage.items));
      setLoadedRange(rangeKey);
      setLoadError("");
    } catch (cause) {
      if (!signal?.aborted) setLoadError(cause instanceof Error ? cause.message : "读取日记失败。");
    }
  }, [character, range.from, range.to, rangeKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const queueBusy = Boolean(items?.some((item) => item.status === "pending" || item.status === "processing" || item.memoryStatus === "pending"));

  useEffect(() => {
    if (!queueBusy) return;
    const controller = new AbortController();
    const tick = () => {
      if (document.visibilityState === "visible") void load(controller.signal);
    };
    const timer = window.setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [queueBusy, load]);

  const journalsForRange = loadedRange === rangeKey ? journals : null;
  return {
    items,
    journals: journalsForRange,
    loading: items === null || journalsForRange === null,
    loadError,
    queueBusy,
    load,
  };
}

function deduplicateJournals(journals: DailyJournal[]): DailyJournal[] {
  const byDate = new Map<string, DailyJournal>();
  for (const journal of journals) {
    const current = byDate.get(journal.localDate);
    if (!current || journal.revision > current.revision || (journal.revision === current.revision && journal.createdAt > current.createdAt)) {
      byDate.set(journal.localDate, journal);
    }
  }
  return [...byDate.values()];
}
