import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CompanionCorner, setCompanionMood } from "../components/CompanionCorner";
import { DiaryLeaf } from "../components/diary/DiaryLeaf";
import { IndexTabs } from "../components/diary/IndexTabs";
import { PageBar } from "../components/diary/PageBar";
import { StateBlock } from "../components/diary/StateBlock";
import { Toast } from "../components/diary/Toast";
import { VideoDesk } from "../components/diary/VideoDesk";
import { useMediaQuery } from "../components/chat/useViewport";
import { useInkEnv } from "../components/ink/useCalm";
import { useCharacter } from "../characters";
import { enqueueDiaryVideo, fetchDiary, retryDiaryItem, runDiaryQueue } from "../lib/diary";
import {
  diaryAt,
  hasText,
  isoDay,
  rangeOf,
  startOfDay,
  type DiaryItemP2,
  type RangeMode,
} from "../components/diary/types";
import "../styles/diary.css";

/** 月 / 年模式一屏最多摊几页；再往后交给底部的「第 n / m 页」。 */
const CHUNK = 8;

export function DiaryPage() {
  const character = useCharacter();
  const wide = useMediaQuery("(min-width: 960px)");
  const env = useInkEnv();

  const [items, setItems] = useState<DiaryItemP2[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [opError, setOpError] = useState("");
  const [mode, setMode] = useState<RangeMode>("week");
  const [cursor, setCursor] = useState<Date>(() => startOfDay(new Date()));
  const [chunk, setChunk] = useState(0);
  const [writing, setWriting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [toast, setToast] = useState(false);

  const pagesBeforeWrite = useRef(0);
  const writeTimer = useRef<number | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      // 后端 B3 补的 mood / weather / diaryTitle 还没进 lib 的类型；这里只按可选字段读，缺了就不画。
      const next = (await fetchDiary(signal)) as DiaryItemP2[];
      setItems(next);
      setLoadError("");
    } catch (cause) {
      if (!signal?.aborted) setLoadError(cause instanceof Error ? cause.message : "读取日记失败。");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const pages = useMemo(
    () =>
      (items ?? [])
        .filter(hasText)
        .slice()
        .sort((a, b) => (diaryAt(b)?.getTime() ?? 0) - (diaryAt(a)?.getTime() ?? 0)),
    [items],
  );

  const queueBusy = Boolean(items?.some((item) => item.status === "pending" || item.status === "processing" || item.memoryStatus === "pending"));

  // 轮询（规范 §7.2.4）：只有页面可见、且队列里真有 pending / processing 时才 5 秒一次。
  useEffect(() => {
    if (!queueBusy) return;
    const controller = new AbortController();
    const tick = () => {
      if (document.visibilityState === "visible") void load(controller.signal);
    };
    const timer = window.setInterval(tick, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(controller.signal);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queueBusy, load]);

  // 写完：她那边真的多出一页了，才落下邮戳 + 报喜。
  useEffect(() => {
    if (!writing) return;
    if (pages.length > pagesBeforeWrite.current) {
      const newest = pages[0];
      setFresh(newest.id);
      setToast(true);
      setWriting(false);
      setCompanionMood("happy", { ttl: 2400 });
      const today = newest.processedAt ?? newest.createdAt;
      if (today) setCursor(startOfDay(new Date(today)));
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
      writeTimer.current = window.setTimeout(() => setFresh(null), 4000);
    }
  }, [writing, pages]);

  useEffect(
    () => () => {
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
    },
    [],
  );

  useEffect(() => {
    setChunk(0);
  }, [mode, cursor]);

  const marks = useMemo(() => new Set(pages.map((item) => (diaryAt(item) ? isoDay(diaryAt(item) as Date) : "")).filter(Boolean)), [pages]);

  const range = rangeOf(mode, cursor);
  const inRange = useMemo(
    () =>
      pages.filter((item) => {
        const at = diaryAt(item);
        if (!at) return false;
        return at >= range.start && at <= new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate(), 23, 59, 59);
      }),
    [pages, range.start, range.end],
  );

  const chunkCount = mode === "week" ? 1 : Math.max(1, Math.ceil(inRange.length / CHUNK));
  const visible = mode === "week" ? inRange : inRange.slice(chunk * CHUNK, chunk * CHUNK + CHUNK);

  const pendingCount = items?.filter((item) => item.status === "pending").length ?? 0;
  const hasMaterial = pendingCount > 0;

  const write = async () => {
    if (writing) return;
    setOpError("");
    pagesBeforeWrite.current = pages.length;
    setWriting(true);
    setCompanionMood("write");
    try {
      await runDiaryQueue();
    } catch (cause) {
      setWriting(false);
      setOpError(cause instanceof Error ? cause.message : "没能叫她动笔，再试一次？");
      setCompanionMood("idle");
      return;
    }
    if (writeTimer.current) window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => {
      setWriting(false);
      setCompanionMood("idle");
    }, 20_000);
    void load();
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
            {items === null && !loadError && <StateBlock kind="loading" title="她在翻小本子…" body="马上就好。" />}

            {loadError && items === null && (
              <StateBlock
                kind="error"
                title="日记本打不开了"
                body="可能是网络不好，也可能她还没醒。"
                detail={loadError}
                action={{ label: "再试一次", onClick: () => void load() }}
              />
            )}

            {items !== null && visible.length === 0 && (
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

            {visible.length > 0 && (
              <motion.div
                key={panelKey}
                className="diary-page__leaves"
                initial={env.calm ? false : { x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={env.calm ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 }}
              >
                {visible.map((item) => (
                  <DiaryLeaf
                    key={item.id}
                    item={item}
                    collapsed={mode !== "week"}
                    fresh={fresh === item.id}
                    fallbackTitle={fallbackTitle}
                  />
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
