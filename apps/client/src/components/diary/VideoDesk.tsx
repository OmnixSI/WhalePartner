/**
 * 页面底部的「给她看的视频」（规范 §7.2.4）：视频降级成一个次要区块，不再是主视觉。
 *
 * - 标题「给她看的视频」+ 一句说明；输入标签「视频链接」；按钮「放进去」是 **secondary**（不再是全页最重的实心）。
 * - 队列行状态词：排着队 / 她正在看… / 看完啦 / 没看成（再试一次）/ 这个看过了。
 * - 运维动作收成 quiet「让她现在就看一个」；旧版视频摘要折叠为「以前的视频小记」。
 * - 轮询由页面负责（只在可见、且队列里有 pending|processing 时每 5 秒），这里只管展示。
 */
import { useState, type FormEvent } from "react";
import { InkLine } from "../ink";
import type { DiaryItemP2 } from "./types";

type Props = {
  items: DiaryItemP2[];
  busy: boolean;
  running: boolean;
  error: string;
  onEnqueue: (url: string) => Promise<void>;
  onRun: () => void;
  onRetry: (item: DiaryItemP2) => void;
  retrying: number | null;
};

const QUEUED = new Set(["pending", "processing", "duplicate"]);

function statusWord(item: DiaryItemP2): string {
  switch (item.status) {
    case "pending":
      return "排着队";
    case "processing":
      return "她正在看…";
    case "done":
      return item.memoryStatus === "failed" ? "日记在，记忆没写进去" : "看完啦";
    case "failed":
      return item.errorStage === "diary" ? "日记没写成" : "没看成";
    case "duplicate":
      return "这个看过了";
    default:
      return "排着队";
  }
}

export function VideoDesk({ items, busy, running, error, onEnqueue, onRun, onRetry, retrying }: Props) {
  const [url, setUrl] = useState("");
  const [folding, setFolding] = useState(true);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = url.trim();
    if (!value || busy) return;
    await onEnqueue(value);
    setUrl("");
  };

  const queue = items.filter((item) => QUEUED.has(item.status) || !item.diaryText);
  const oldNotes = items.filter((item) => Boolean(item.summary));

  return (
    <section className="vids" aria-labelledby="vids-title">
      <header className="vids__head">
        <h2 className="vids__title" id="vids-title">
          给她看的视频
        </h2>
        <p className="vids__lead">把喜欢的 B 站视频链接放进来，她会挑时间看，再写进日记。</p>
      </header>

      <form className="vids__form" onSubmit={submit}>
        <label className="sr-only" htmlFor="vids-url">
          视频链接
        </label>
        <input
          id="vids-url"
          className="field vids__input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="粘贴 B 站链接、b23.tv 短链或 BV 号"
          maxLength={500}
          disabled={busy}
          autoComplete="off"
        />
        <button type="submit" className="btn btn--secondary" disabled={!url.trim() || busy}>
          {busy ? "放进去…" : "放进去"}
        </button>
      </form>

      {error && (
        <p className="vids__error" role="alert">
          {error}
        </p>
      )}

      <div className="vids__bar">
        <span className="vids__count">
          {queue.length > 0 ? `排队中 ${queue.filter((item) => item.status === "pending").length} 条` : "队列是空的"}
        </span>
        <button type="button" className="btn btn--quiet vids__run" onClick={onRun} disabled={running || queue.length === 0}>
          {running ? "叫她了…" : "让她现在就看一个"}
        </button>
      </div>

      {queue.length > 0 && (
        <ul className="vids__list">
          {queue.map((item) => (
            <li key={item.id} className="vids__row">
              <div className="vids__rowbody">
                <span className="vids__rowtitle">{item.title || item.inputUrl}</span>
                <span className="vids__status" data-status={item.status}>
                  {statusWord(item)}
                </span>
                {item.status === "failed" && item.error && (
                  <span className="vids__why" role="status">
                    {item.error}
                  </span>
                )}
              </div>
              {item.status === "failed" && (
                <button type="button" className="btn btn--quiet" onClick={() => onRetry(item)} disabled={retrying === item.id}>
                  {retrying === item.id ? "再试一次…" : "再试一次"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {oldNotes.length > 0 && (
        <div className="vids__old">
          <InkLine className="vids__rule" id="vids-rule" />
          <button type="button" className="btn btn--quiet vids__fold" aria-expanded={!folding} onClick={() => setFolding((v) => !v)}>
            以前的视频小记（{oldNotes.length}）
          </button>
          {!folding && (
            <ul className="vids__oldlist">
              {oldNotes.map((item) => (
                <li key={`old-${item.id}`}>
                  <span className="vids__oldtitle">{item.title || "一段视频"}</span>
                  <span className="vids__oldtext">{item.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
