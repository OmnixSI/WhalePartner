import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CompanionCorner, setCompanionMood } from "../components/CompanionCorner";
import { PageHeader } from "../components/shell/PageHeader";
import { Button } from "../components/ui/Button";
import { spring } from "../motion/tokens";
import { DailyJournalLeaf } from "../components/diary/DailyJournalLeaf";
import { DiaryLeaf } from "../components/diary/DiaryLeaf";
import { DiaryCalendar, DiaryYearOverview } from "../components/diary/DiaryCalendar";
import { PageBar } from "../components/diary/PageBar";
import { StateBlock } from "../components/diary/StateBlock";
import { Toast } from "../components/diary/Toast";
import { Tabs } from "../components/ui/Tabs";
import { VideoDesk } from "../components/diary/VideoDesk";
import { useInkEnv } from "../components/ink/useCalm";
import { useCharacter } from "../characters";
import { enqueueDiaryVideo, generateJournal, retryDiaryItem, runDiaryQueue, type DailyJournal } from "../lib/diary";
import { useHubRefresh } from "../lib/useHubRefresh";
import { useDiaryPageData } from "../components/diary/useDiaryPageData";
import {
  diaryAt,
  hasText,
  isoDay,
  journalDate,
  rangeOf,
  shortTheme,
  startOfDay,
  type DiaryItemP2,
  type RangeMode,
} from "../components/diary/types";
import "../styles/diary.css";

type DiaryPageEntry =
  | { kind: "video"; id: string; at: Date; item: DiaryItemP2 }
  | { kind: "journal"; id: string; at: Date; journal: DailyJournal };

function themeOf(entry: DiaryPageEntry): string {
  if (entry.kind === "journal") return shortTheme(entry.journal.text);
  const title = entry.item.diaryTitle?.trim() || entry.item.title?.trim();
  return shortTheme(title || entry.item.summary || entry.item.diaryText || "");
}

export function DiaryPage() {
  const character = useCharacter();
  const env = useInkEnv();

  const [mode, setMode] = useState<RangeMode>("week");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const range = useMemo(() => rangeOf(mode, cursor), [mode, cursor]);
  const { items, journals, loading, loadError, load } = useDiaryPageData(character.id, {
    from: isoDay(range.start),
    to: isoDay(range.end),
  });
  useHubRefresh(["diary.updated"], () => void load());
  const [opError, setOpError] = useState("");
  const [writing, setWriting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [toast, setToast] = useState(false);

  const writeTimer = useRef<number | null>(null);

  const pages = useMemo(
    (): DiaryPageEntry[] => {
      const videoEntries: DiaryPageEntry[] = (items ?? []).filter(hasText).flatMap((item) => {
        const at = diaryAt(item);
        return at ? [{ kind: "video", id: "video-" + item.id, at, item }] : [];
      });
      const journalEntries: DiaryPageEntry[] = (journals ?? []).flatMap((journal) => {
        const at = journalDate(journal.localDate);
        return at ? [{ kind: "journal", id: journal.id, at, journal }] : [];
      });
      return [...videoEntries, ...journalEntries].sort((a, b) => b.at.getTime() - a.at.getTime());
    },
    [items, journals],
  );

  useEffect(
    () => () => {
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
    },
    [],
  );

  const endExclusive = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() + 1);
  const inRange = useMemo(
    () => pages.filter((entry) => entry.at >= range.start && entry.at < endExclusive),
    [pages, range.start, endExclusive.getTime()],
  );

  const grouped = useMemo(() => {
    const groups: Array<{ key: string; entries: DiaryPageEntry[] }> = [];
    for (const entry of inRange) {
      const key = isoDay(entry.at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.entries.push(entry);
      else groups.push({ key, entries: [entry] });
    }
    return groups;
  }, [inRange]);

  const themesByDate = useMemo(() => {
    const themes = new Map<string, string[]>();
    for (const entry of inRange) {
      const key = isoDay(entry.at);
      const theme = themeOf(entry) || "有日记";
      const dayThemes = themes.get(key) ?? [];
      dayThemes.push(theme);
      themes.set(key, dayThemes);
    }
    return themes;
  }, [inRange]);

  const countByMonth = useMemo(() => {
    const counts = new Map<number, number>();
    for (const entry of inRange) {
      const month = entry.at.getMonth();
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    return counts;
  }, [inRange]);

  const selectedEntries = useMemo(
    () => selectedDay ? inRange.filter((entry) => isoDay(entry.at) === selectedDay) : [],
    [inRange, selectedDay],
  );
  const selectedDate = selectedDay ? journalDate(selectedDay) : null;
  const selectedLabel = selectedDate ? (selectedDate.getMonth() + 1) + "月" + selectedDate.getDate() + "日" : "这一天";
  const pendingCount = items?.filter((item) => item.status === "pending").length ?? 0;
  const hasMaterial = pendingCount > 0;
  const fallbackTitle = (cursor.getMonth() + 1) + "月" + cursor.getDate() + "日";

  const changeMode = (next: RangeMode) => {
    setMode(next);
    setSelectedDay(null);
  };

  const changeCursor = (date: Date) => {
    setCursor(startOfDay(date));
    setSelectedDay(null);
  };

  const selectDay = (date: Date) => {
    setCursor(startOfDay(date));
    setSelectedDay(isoDay(date));
  };

  const selectMonth = (date: Date) => {
    setMode("month");
    setCursor(startOfDay(date));
    setSelectedDay(null);
  };

  const renderEntry = (entry: DiaryPageEntry, collapsed: boolean) => entry.kind === "journal" ? (
    <DailyJournalLeaf key={entry.id} journal={entry.journal} collapsed={collapsed} fresh={fresh === entry.id} />
  ) : (
    <DiaryLeaf key={entry.id} item={entry.item} collapsed={collapsed} fresh={fresh === entry.id} fallbackTitle={fallbackTitle} />
  );

  const renderDayGroup = (key: string, entries: DiaryPageEntry[]) => {
    const date = entries[0]?.at;
    const label = date ? `${date.getMonth() + 1} 月 ${date.getDate()} 日` : key;
    const weekday = date ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()] : "";
    return (
      <section className="diary-day" key={key} aria-label={`${label}的日记`}>
        <header className="diary-day__head">
          <h2 className="diary-day__title">{label}</h2>
          <span className="diary-day__meta">{weekday} · {entries.length} 篇</span>
        </header>
        <div className="diary-day__cards">{entries.map((entry) => renderEntry(entry, false))}</div>
      </section>
    );
  };

  const write = async () => {
    if (writing) return;
    setOpError("");
    setWriting(true);
    setCompanionMood("write");
    try {
      const today = startOfDay(new Date());
      const journal = await generateJournal(character.id, isoDay(today));
      if (!journal) {
        setOpError("今天还没有可写进日记的共同经历。聊几句或等她整理完视频，再试一次吧。");
        setCompanionMood("idle");
        return;
      }
      await load();
      setCursor(today);
      setSelectedDay(null);
      setFresh(journal.id);
      setToast(true);
      setCompanionMood("happy", { ttl: 2400 });
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
      writeTimer.current = window.setTimeout(() => setFresh(null), 4000);
    } catch (cause) {
      setOpError(cause instanceof Error ? cause.message : "没能叫她动笔，再试一次？");
      setCompanionMood("idle");
    } finally {
      setWriting(false);
    }
  };

  const enqueue = async (url: string) => {
    setSubmitting(true);
    setOpError("");
    try {
      await enqueueDiaryVideo(url);
      await load();
    } catch (cause) {
      setOpError(cause instanceof Error ? cause.message : "没放进去，再试一次？");
    } finally {
      setSubmitting(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setOpError("");
    try {
      await runDiaryQueue();
      await load();
    } catch (cause) {
      setOpError(cause instanceof Error ? cause.message : "没能叫她开始看。");
    } finally {
      setRunning(false);
    }
  };

  const retry = async (item: DiaryItemP2) => {
    setRetrying(item.id);
    setOpError("");
    try {
      await retryDiaryItem(item.id);
      await load();
    } catch (cause) {
      setOpError(cause instanceof Error ? cause.message : "重试没成功。");
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="page diary-page">
      <div className="diary-page__inner">
        <PageHeader
          eyebrow="手帐 · 日记"
          title={`${character.name}的日记`}
          actions={
            <Button variant="primary" className="diary-page__write" onClick={() => void write()} disabled={writing}>
              {writing ? "她在写…" : "请她写今天的"}
            </Button>
          }
        />

        <div className="diary-page__controls">
          <Tabs
            items={[{ value: "week", label: "周" }, { value: "month", label: "月" }, { value: "year", label: "年" }]}
            value={mode}
            onValueChange={(value) => changeMode(value as RangeMode)}
            variant="segmented"
            label="日记范围"
            panelId="diary-panel"
          />
          <PageBar mode={mode} cursor={cursor} onCursor={changeCursor} onToday={() => changeCursor(startOfDay(new Date()))} />
        </div>

        <div className="diary-page__stage">
          <div className="diary-page__panel" id="diary-panel" role="tabpanel" aria-label="日记内容">
            {loading && !loadError && <StateBlock kind="loading" title="她在翻小本子…" body="马上就好。" />}

            {loadError && (
              <StateBlock
                kind="error"
                title="日记本打不开了"
                body="可能是网络不好，也可能她还没醒。"
                detail={loadError}
                action={{ label: "再试一次", onClick: () => void load() }}
              />
            )}

            {!loading && !loadError && mode === "month" && !selectedDay && (
              <DiaryCalendar month={cursor} selectedDate={isoDay(cursor)} themesByDate={themesByDate} onSelect={selectDay} />
            )}

            {!loading && !loadError && mode === "month" && selectedDay && (
              <section className="diary-page__day-detail" aria-label={selectedLabel + "的日记"}>
                <button type="button" className="btn btn--quiet diary-page__back" onClick={() => setSelectedDay(null)}>
                  <span aria-hidden="true">‹</span> 返回本月日历
                </button>
                <h2 className="diary-page__day-title">{selectedLabel}的日记</h2>
                {selectedEntries.length === 0 ? (
                  <StateBlock
                    kind="empty"
                    title={selectedLabel + "还没有日记"}
                    body="这一天先留白，回到月历再看看别的日期吧。"
                    action={{ label: "返回月历", onClick: () => setSelectedDay(null) }}
                  />
                ) : (
                  <motion.div
                    key={"day-" + selectedDay}
                    className="diary-page__leaves"
                    initial={env.calm ? false : { x: 24, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={env.calm ? { duration: 0 } : spring.page}
                  >
                    {selectedEntries.map((entry) => renderEntry(entry, false))}
                  </motion.div>
                )}
              </section>
            )}

            {!loading && !loadError && mode === "year" && (
              <DiaryYearOverview year={cursor.getFullYear()} countByMonth={countByMonth} onSelectMonth={selectMonth} />
            )}

            {!loading && !loadError && mode === "week" && inRange.length === 0 && (
              <StateBlock
                kind="empty"
                title="这几天她还没写日记"
                body={
                  hasMaterial
                    ? "每天晚上她会自己写。也可以现在请她写今天的。"
                    : "今天我们还没一起经历什么。聊几句，再来找我写吧。"
                }
                action={hasMaterial ? { label: "请她写今天的", onClick: () => void write() } : undefined}
              >
                {!hasMaterial && (
                  <Link className="btn btn--secondary diary-page__gochat" to="/">
                    去聊天
                  </Link>
                )}
              </StateBlock>
            )}

            {!loading && !loadError && mode === "week" && inRange.length > 0 && (
              <motion.div
                key={"week-" + isoDay(cursor)}
                className="diary-page__leaves"
                initial={env.calm ? false : { x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={env.calm ? { duration: 0 } : spring.page}
              >
                {grouped.map((group) => renderDayGroup(group.key, group.entries))}
              </motion.div>
            )}
          </div>
        </div>

        {writing && (
          <p className="diary-page__writing" role="status">
            她在写，马上好。
          </p>
        )}

        <VideoDesk
          items={items ?? []}
          busy={submitting}
          running={running}
          error={opError}
          onEnqueue={enqueue}
          onRun={() => void run()}
          onRetry={(item) => void retry(item)}
          retrying={retrying}
        />
      </div>

      <CompanionCorner />
      <Toast open={toast} text="写好啦，翻到今天那一页看看。" onClose={() => setToast(false)} duration={4200} />
    </div>
  );
}
