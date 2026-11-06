import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useCharacter } from "../characters";
import { DailyJournalList } from "../components/DailyJournalList";
import { enqueueDiaryVideo, fetchDiary, retryDiaryItem, runDiaryQueue, type DiaryItem } from "../lib/diary";

function when(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusText(item: DiaryItem) {
  if (item.status === "processing") return "正在看视频、写日记…";
  if (item.status === "failed") return item.errorStage === "diary" ? "日记生成失败" : "视频处理失败";
  if (item.status === "duplicate") return "这条视频已经有日记了";
  if (item.memoryStatus === "saved") return "日记已写入记忆";
  if (item.memoryStatus === "failed") return "日记已保存，记忆写入失败";
  if (item.memoryStatus === "pending") return "日记已保存，正在写入记忆…";
  return "等待定时处理";
}

function DiaryEntry({ item, onRetry, retrying }: { item: DiaryItem; onRetry: (item: DiaryItem) => void; retrying: number | null }) {
  return (
    <article className="card diary-entry" id={`diary-entry-${item.id}`}>
      <div className="diary-entry__meta">
        <span>{when(item.processedAt ?? item.createdAt)}</span>
        <span className={`diary-status${item.memoryStatus === "failed" ? " diary-status--failed" : ""}`}>{statusText(item)}</span>
      </div>
      <h3>{item.title || "今天看的视频"}</h3>
      <p className="diary-entry__text">{item.diaryText}</p>
      {item.memoryError && <p className="diary-error" role="status">{item.memoryError}</p>}
      <div className="diary-entry__actions">
        {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">打开原视频 ↗</a>}
        {item.memoryStatus === "failed" && (
          <button className="diary-button diary-button--quiet" disabled={retrying === item.id} onClick={() => onRetry(item)}>
            {retrying === item.id ? "正在重试…" : "重试记忆写入"}
          </button>
        )}
      </div>
      {item.summary && <details className="diary-summary"><summary>查看视频摘要</summary><p>{item.summary}</p></details>}
    </article>
  );
}

function QueueItem({ item, onRetry, retrying }: { item: DiaryItem; onRetry: (item: DiaryItem) => void; retrying: number | null }) {
  return (
    <li className="diary-queue__item">
      <div className="diary-queue__body">
        <div className="diary-queue__title">{item.title || item.inputUrl}</div>
        <div className={`diary-status${item.status === "failed" ? " diary-status--failed" : ""}`}>{statusText(item)}</div>
        {item.error && <p className="diary-error" role="alert">{item.error}</p>}
        {item.status === "duplicate" && item.duplicateOf !== null && (
          <a href={`#diary-entry-${item.duplicateOf}`}>查看已有日记</a>
        )}
      </div>
      {item.status === "failed" && (
        <button className="diary-button diary-button--quiet" disabled={retrying === item.id} onClick={() => onRetry(item)}>
          {retrying === item.id ? "正在重试…" : "重试处理"}
        </button>
      )}
    </li>
  );
}

export function DiaryPage() {
  const character = useCharacter();
  const [items, setItems] = useState<DiaryItem[] | null>(null);
  const [url, setUrl] = useState("");
  const [operationError, setOperationError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [running, setRunning] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setItems(await fetchDiary(signal));
      setLoadError("");
    } catch (cause) {
      if (!signal?.aborted) setLoadError(cause instanceof Error ? cause.message : "读取日记失败。");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => { void load(controller.signal); }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = url.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setOperationError("");
    try {
      await enqueueDiaryVideo(value);
      setUrl("");
      await load();
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : "添加视频失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setOperationError("");
    try {
      await runDiaryQueue();
      await load();
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : "启动日记处理失败。");
    } finally {
      setRunning(false);
    }
  };

  const retry = async (item: DiaryItem) => {
    setRetrying(item.id);
    setOperationError("");
    try {
      await retryDiaryItem(item.id);
      await load();
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : "重试失败。");
    } finally {
      setRetrying(null);
    }
  };

  const pending = items?.some((item) => item.status === "pending" || item.status === "failed" || item.memoryStatus === "pending") ?? false;
  const queue = items?.filter((item) => !item.diaryText && item.status !== "done") ?? [];
  const entries = items?.filter((item) => Boolean(item.diaryText)) ?? [];
  const error = operationError || loadError;

  return (
    <div className="page">
      <div className="page__inner">
        <header>
          <h1 className="page__title">她的日记</h1>
        </header>

        <DailyJournalList character={character} />

        <details className="legacy-diary">
        <summary>视频与待看列表</summary>
        <section className="card diary-add">
          <h3>分享视频</h3>
          <form className="diary-form" onSubmit={add}>
            <label className="sr-only" htmlFor="diary-video-url">Bilibili 视频链接或 BV 号</label>
            <input
              id="diary-video-url"
              className="diary-input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="粘贴 Bilibili 链接、b23.tv 短链或 BV 号"
              maxLength={500}
              disabled={submitting}
            />
            <button className="diary-button" type="submit" disabled={!url.trim() || submitting}>
              {submitting ? "正在添加…" : "加入待看"}
            </button>
          </form>
          <div className="diary-add__actions">
            <span>自动处理</span>
            <button className="diary-button diary-button--quiet" onClick={run} disabled={running || !pending}>
              {running ? "正在启动…" : "立即处理一条"}
            </button>
          </div>
        </section>

        {error && <div className="card diary-error-card" role="alert"><strong>{operationError ? "操作失败" : "日记服务暂不可用"}</strong><p>{error}</p>{!operationError && <button className="diary-button diary-button--quiet" onClick={() => void load()}>重试读取</button>}</div>}
        {items === null && !error && <div className="card"><p>正在翻她的小本子…</p></div>}

        {items !== null && queue.length > 0 && (
          <section className="card diary-queue">
            <h3>待看列表</h3>
            <ul>{queue.map((item) => <QueueItem key={item.id} item={item} onRetry={retry} retrying={retrying} />)}</ul>
          </section>
        )}

        {items !== null && entries.length > 0 && (
          <section className="diary-list" aria-label="已生成的日记">
            {entries.map((item) => <DiaryEntry key={item.id} item={item} onRetry={retry} retrying={retrying} />)}
          </section>
        )}

        {items !== null && !error && entries.length === 0 && queue.length === 0 && (
          <div className="card empty">
            <h3>没有视频记录</h3>
          </div>
        )}
        </details>
      </div>
    </div>
  );
}
