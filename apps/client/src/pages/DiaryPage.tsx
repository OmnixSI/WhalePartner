import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CompanionCorner, setCompanionMood } from "../components/CompanionCorner";
import { spring } from "../motion/tokens";
import { DailyJournalLeaf } from "../components/diary/DailyJournalLeaf";
import { DiaryLeaf } from "../components/diary/DiaryLeaf";
import { IndexTabs } from "../components/diary/IndexTabs";
import { PageBar } from "../components/diary/PageBar";
import { StateBlock } from "../components/diary/StateBlock";
import { Toast } from "../components/diary/Toast";
import { VideoDesk } from "../components/diary/VideoDesk";
import { useMediaQuery } from "../components/chat/useViewport";
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
  startOfDay,
  type DiaryItemP2,
  type RangeMode,
} from "../components/diary/types";
import "../styles/diary.css";

/** 月 / 年模式一屏最多摊几页；再往后交给底部的「第 n / m 页」。 */
const CHUNK = 8;

type DiaryPageEntry =
  | { kind: "video"; id: string; at: Date; item: DiaryItemP2 }
  | { kind: "journal"; id: string; at: Date; journal: DailyJournal };

export function DiaryPage() {
  const character = useCharacter();
  const wide = useMediaQuery("(min-width: 960px)");
  const env = useInkEnv();

  const [mode, setMode] = useState<RangeMode>("week");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const range = useMemo(() => rangeOf(mode, cursor), [mode, cursor]);
  const { items, journals, loading, loadError, load } = useDiaryPageData(character.id, {
    from: isoDay(range.start),
    to: isoDay(range.end),
  });
  useHubRefresh(["diary.updated"], () => void load());
  const [opError, setOpError] = useState("");
  const [chunk, setChunk] = useState(0);
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
        return at ? [{ kind: "video", id: `video-${item.id}`, at, item }] : [];
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

  useEffect(() => {
    setChunk(0);
  }, [mode, cursor]);

  const marks = useMemo(() => new Set(pages.map((item) => isoDay(item.at))), [pages]);
  const inRange = useMemo(
    () => pages.filter((item) => item.at >= range.start && item.at <= new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate(), 23, 59, 59)),
    [pages, range.start, range.end],
  );

  const chunkCount = mode === "week" ? 1 : Math.max(1, Math.ceil(inRange.length / CHUNK));
  const visible = mode === "week" ? inRange : inRange.slice(chunk * CHUNK, chunk * CHUNK + CHUNK);

  const pendingCount = items?.filter((item) => item.status === "pending").length ?? 0;
  const hasMaterial = pendingCount > 0;

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

  const fallbackTitle = `${cursor.getMonth() + 1}月${cursor.getDate()}日`;
  const panelKey = `${mode}-${isoDay(cursor)}-${chunk}`;

  return (
    <div className="page diary-page">
      <div className="diary-page__inner">
        <header className="diary-page__head">
          <h1 className="diary-page__title">{character.name}的日记</h1>
          <button
            type="button"
            className="btn btn--primary diary-page__write"
            onClick={() => void write()}
            disabled={writing}
          >
            {writing ? "她在写…" : "请她写今天的"}
          </button>
        </header>

        <div className="diary-page__stage">
          <IndexTabs value={mode} onChange={setMode} vertical={wide} panelId="diary-panel" />

          <div className="diary-page__panel" id="diary-panel" role="tabpanel" aria-label="日记正文">
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

            {!loading && !loadError && visible.length === 0 && (
              <StateBlock
                kind="empty"
                title="这几天她还没写日记"
                body={
                  hasMaterial
                    ? "每天晚上她会自己写。也可以现在请她写今天的。"
                    : "今天我们还没一起经历什么。聊几句，再来找我写吧。"
                }
                action={
                  hasMaterial
                    ? { label: "请她写今天的", onClick: () => void write() }
                    : undefined
                }
              >
                {!hasMaterial && (
                  <Link className="btn btn--secondary diary-page__gochat" to="/">
                    去聊天
                  </Link>
                )}
              </StateBlock>
            )}

            {!loading && !loadError && visible.length > 0 && (
              <motion.div
                key={panelKey}
                className="diary-page__leaves"
                initial={env.calm ? false : { x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={env.calm ? { duration: 0 } : spring.page}
              >
                {visible.map((entry) => entry.kind === "journal" ? (
                  <DailyJournalLeaf key={entry.id} journal={entry.journal} collapsed={mode !== "week"} fresh={fresh === entry.id} />
                ) : (
                  <DiaryLeaf key={entry.id} item={entry.item} collapsed={mode !== "week"} fresh={fresh === entry.id} fallbackTitle={fallbackTitle} />
                ))}
              </motion.div>
            )}

            {mode !== "week" && chunkCount > 1 && (
              <div className="diary-page__pager">
                <button type="button" className="pagebar__step" disabled={chunk === 0} onClick={() => setChunk((v) => Math.max(0, v - 1))}>
                  <span aria-hidden>‹</span> 上一页
                </button>
                <span className="diary-page__pageno">
                  第 {chunk + 1} / {chunkCount} 页
                </span>
                <button
                  type="button"
                  className="pagebar__step"
                  disabled={chunk >= chunkCount - 1}
                  onClick={() => setChunk((v) => Math.min(chunkCount - 1, v + 1))}
                >
                  下一页 <span aria-hidden>›</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <PageBar mode={mode} cursor={cursor} marks={marks} onCursor={setCursor} onToday={() => setCursor(startOfDay(new Date()))} />

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
