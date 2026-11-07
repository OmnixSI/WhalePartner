/**
 * 「她的见闻」页（规范 §7.7.4）：按天分组的剪报墙 + 筛选 + 「让她现在去逛逛」。
 *
 * 数据纪律：不编内容。接口不在 / 出错就进错误态；今天什么都没逛到就是空态；
 * 服务端说 429（刚回来不久）就把那句原话摆出来。
 * 她的进度靠 `useSurfEvents` 的 SSE 推过来，页不可见时断开、回来先对齐一次状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/chat/ConfirmDialog";
import { Toast } from "../components/diary/Toast";
import { PostcardCard } from "../components/surf/PostcardCard";
import { SurfEmpty } from "../components/surf/SurfEmpty";
import { SurfFilters } from "../components/surf/SurfFilters";
import { PostcardDetail } from "../components/surf/PostcardDetail";
import { SurfStatus, type SurfPhase } from "../components/surf/SurfStatus";
import { useSurfEvents, type SurfShareEvent } from "../components/surf/useSurfEvents";
import { useCharacter } from "../characters";
import { useInkEnv } from "../components/ink/useCalm";
import { openExternalUrl } from "../lib/external-url";
import {
  dateRangeBounds,
  dayLabelOf,
  deleteSurfItem,
  getSurfFeed,
  getSurfStatus,
  isFresh,
  markSeen,
  nextRunText,
  putSurfSettings,
  readSeenId,
  runSurf,
  type DateRange,
  type SurfFeedItem,
  type SurfKind,
  type SurfSource,
  type SurfStatus as Status,
} from "../lib/surf";
import "../styles/surf.css";

const PAGE_SIZE = 20;

export function SurfPage() {
  const character = useCharacter();
  const env = useInkEnv();

  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<SurfFeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<SurfKind | "all">("all");
  const [site, setSite] = useState("");
  const [range, setRange] = useState<DateRange>("all");
  const [day, setDay] = useState("");
  const [sources, setSources] = useState<SurfSource[]>([]);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<SurfPhase | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [detail, setDetail] = useState<SurfFeedItem | null>(null);
  const [confirming, setConfirming] = useState<SurfFeedItem | null>(null);
  const [busy, setBusy] = useState(false);

  const openSourceUrl = (url: string) => {
    void openExternalUrl(url).catch((cause: unknown) => {
      console.warn("Could not open surf source URL", cause);
      setToast(cause instanceof Error ? `没能打开原链接：${cause.message}` : "没能打开原链接，请检查系统默认浏览器。");
    });
  };

  // 进来之前的「已看」水位：用来判断哪张卡是新的，进入本页后推进水位。
  const seenAtMount = useRef(readSeenId());

  const load = useCallback(
    async (nextPage: number, options: { append?: boolean; silent?: boolean; signal?: AbortSignal } = {}) => {
      if (!options.append && !options.silent) setState("loading");
      setError("");
      try {
        const bounds = dateRangeBounds(range, day);
        const feed = await getSurfFeed(
          {
            character: character.id,
            kind: kind === "all" ? undefined : kind,
            page: nextPage,
            pageSize: PAGE_SIZE,
            q: applied,
            site: site || undefined,
            ...bounds,
          },
          options.signal,
        );
        setItems((prev) => (options.append ? [...prev, ...feed.items] : feed.items));
        setTotal(feed.total);
        if (feed.sources) setSources(feed.sources);
        setPage(nextPage);
        setState("ready");
        const maxId = feed.items.reduce((max, item) => Math.max(max, item.id), 0);
        if (!options.append && maxId > 0) markSeen(maxId);
      } catch (cause) {
        if (options.signal?.aborted) return;
        setError(cause instanceof Error ? cause.message : "见闻翻不开。");
        setState("error");
      }
    },
    [character.id, kind, applied, site, range, day],
  );

  const refreshStatus = useCallback(async () => {
    const next = await getSurfStatus(character.id);
    if (!next) return;
    setStatus(next);
    // 刷新页面或从别处回来时，她正好在逛：直接接上当前这一步。
    if (next.running && next.stage) {
      setPhase((prev) => (prev?.kind === "browsing" && !next.detail ? prev : { kind: "browsing", stage: next.stage!, detail: next.detail, paused: next.waiting }));
    }
  }, [character.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(1, { signal: controller.signal });
    void refreshStatus();
    return () => controller.abort();
  }, [load, refreshStatus]);

  // 页面可见时每 60 秒兜底刷新一次（SSE 断了也不至于一直停在旧数据）。
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  // 新见闻：整页静默重拉第一页（实时事件里没有摘要和链接，重拉能拿到完整的一条）。
  const reloadTimer = useRef<number | null>(null);
  const onItem = useCallback(() => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => void load(1, { silent: true }), 400);
  }, [load]);
  useEffect(
    () => () => {
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    },
    [],
  );

  useSurfEvents(character.id, {
    onSession: (event) => {
      if (event.state === "start") setPhase({ kind: "browsing", stage: "searching" });
      else {
        setPhase(event.count && event.count > 0 ? { kind: "done", count: event.count } : { kind: "empty" });
        setBusy(false);
        void refreshStatus();
        void load(1, { silent: true });
      }
    },
    onStep: (event) => setPhase({ kind: "browsing", stage: event.stage, detail: event.detail, paused: event.paused }),
    onItem,
    onShare: (_event: SurfShareEvent) => {
      // 分享进聊天页；见闻页只负责刷新，不在这里插消息。
      void refreshStatus();
    },
    onOpen: () => void refreshStatus(),
  });

  const groups = useMemo(() => {
    const map = new Map<string, SurfFeedItem[]>();
    for (const item of items) {
      const label = dayLabelOf(item.createdAt);
      const list = map.get(label) ?? [];
      list.push(item);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [items]);

  const trigger = async () => {
    if (busy) return;
    setBusy(true);
    const answer = await runSurf(character.id);
    if (answer.ok) {
      setPhase({ kind: "browsing", stage: "searching" });
      setToast("她出门了，逛逛就回来。");
      void refreshStatus();
      return;
    }
    setBusy(false);
    if (answer.code === "too_soon") setToast(answer.message ?? "她刚回来不久，歇一会儿再去吧。");
    else if (answer.code === "already_running") setToast("她正在逛呢。");
    else if (answer.code === "quota") setToast("这个月的贝壳快用完了，她先歇着。");
    else setToast(answer.message ?? "现在叫不动她。");
  };

  const enableBack = async () => {
    try {
      const saved = await putSurfSettings(character.id, { enabled: true });
      setStatus((prev) => (prev ? { ...prev, pausedReason: null } : prev));
      setToast("打开啦，她会自己出去逛。");
      void saved;
      void refreshStatus();
    } catch {
      setToast("现在改不了设置。");
    }
  };

  const forget = async (item: SurfFeedItem) => {
    try {
      await deleteSurfItem(item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setToast("已经忘掉了。");
    } catch {
      setToast("现在忘不掉，等会儿再试。");
    }
  };

  const filtered = kind !== "all" || Boolean(site) || range !== "all";
  const clearFilters = () => {
    setKind("all");
    setSite("");
    setRange("all");
    setDay("");
    setPage(1);
  };
  const disabled = status?.pausedReason === "disabled";
  const lowQuota = status?.pausedReason === "quota";
  const running = Boolean(status?.running) || busy;

  return (
    <div className="page page--surf" data-elder={env.elder ? "on" : "off"}>
      <div className="page__inner">
        <header className="surf-head">
          <div className="surf-head__text">
            <h1 className="page__title">{character.name}的见闻</h1>
            <p className="surf-head__lead">
              {status
                ? disabled
                  ? "她现在不去逛了"
                  : `她今天逛了 ${status.todayCount} 个地方 · ${nextRunText(status)}`
                : "正在问她今天逛到哪儿了…"}
            </p>
          </div>
          <SurfStatus phase={phase} onDismiss={() => setPhase(null)} />
        </header>

        <div className="surf-bar">
          <SurfFilters
            kind={kind}
            site={site}
            range={range}
            day={day}
            sources={sources}
            onKind={(next) => {
              setKind(next);
              setPage(1);
            }}
            onSite={(next) => {
              setSite(next);
              setPage(1);
            }}
            onRange={(next) => {
              setRange(next);
              if (next === "day" && !day) setDay(new Date().toISOString().slice(0, 10));
              setPage(1);
            }}
            onDay={(next) => {
              setDay(next);
              setPage(1);
            }}
          />

          <form
            className="surf-search"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(query);
              setPage(1);
            }}
          >
            <input
              className="field surf-search__field"
              type="search"
              value={query}
              placeholder="找找她逛到的东西…"
              aria-label="搜她的见闻"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" className="btn btn--secondary btn--sm">
              找
            </button>
          </form>

          <button
            type="button"
            className="btn btn--primary surf-run"
            onClick={() => void trigger()}
            disabled={running || disabled}
            aria-busy={running}
          >
            {running ? "她正在逛…" : "让她现在去逛逛"}
          </button>
        </div>

        {state === "error" ? (
          <SurfEmpty
            kind="error"
            icon="bottle"
            title="见闻翻不开了"
            body="网络好像不太好，我再试一次？"
            detail={error}
            action={{ label: "再试一次", onClick: () => void load(1) }}
          />
        ) : state === "loading" ? (
          <SurfEmpty kind="loading" icon="newspaper" title="我在整理剪报…" />
        ) : items.length === 0 ? (
          applied.trim() ? (
            <SurfEmpty
              kind="empty"
              icon="newspaper"
              title={`没翻到带「${applied.trim()}」的`}
              body="换个词试试，或者等我下次出去逛的时候留意一下。"
              action={{
                label: "清掉搜索",
                onClick: () => {
                  setQuery("");
                  setApplied("");
                  setPage(1);
                },
              }}
            />
          ) : filtered ? (
            <SurfEmpty
              kind="empty"
              icon="newspaper"
              title="这个范围里我还没带回东西"
              body="换个来源或者日期看看。"
              action={{ label: "清掉筛选", onClick: clearFilters }}
            />
          ) : lowQuota ? (
            <SurfEmpty
              kind="empty"
              icon="conch"
              title="这个月的贝壳快用完了"
              body="我先歇着，下个月 1 号再去逛。"
              action={{ label: "去看看额度", onClick: () => window.location.assign("/settings#quota") }}
            />
          ) : disabled ? (
            <SurfEmpty
              kind="empty"
              icon="lighthouse"
              title="我现在不出门了"
              body="你打开之后，我会自己去看视频、翻网页，回来讲给你听。"
              action={{ label: "打开", onClick: () => void enableBack() }}
            />
          ) : (
            <SurfEmpty
              kind="empty"
              icon="phone"
              title="还没出去逛过呢"
              body="我会挑个时间去看看视频、翻翻网页，把有意思的剪下来给你。"
              action={{ label: "让她现在去逛逛", onClick: () => void trigger() }}
            />
          )
        ) : (
          <>
            {groups.map(([label, list]) => (
              <section className="surf-day" key={label} aria-label={label}>
                <h2 className="surf-day__date">
                  <span className="surf-day__line" aria-hidden />
                  <span className="surf-day__text">{label}</span>
                  <span className="surf-day__line" aria-hidden />
                </h2>
                <ul className="surf-grid">
                  {list.map((item) => (
                    <PostcardCard
                      key={item.id}
                      item={item}
                      fresh={isFresh(item, seenAtMount.current)}
                      onOpen={setDetail}
                      onForget={setConfirming}
                      onOpenUrl={openSourceUrl}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {items.length < total ? (
              <div className="surf-more">
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => void load(page + 1, { append: true })}
                >
                  再往前翻翻
                </button>
              </div>
            ) : (
              <p className="surf-end">翻到头了。</p>
            )}
          </>
        )}
      </div>

      <PostcardDetail item={detail} onClose={() => setDetail(null)} onForget={setConfirming} onOpenUrl={openSourceUrl} />
      <ConfirmDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`要忘掉「${confirming?.title ?? ""}」吗？`}
        body="她会连同这段记忆一起忘掉，以后也不会再逛回来。"
        cancelLabel="先留着"
        confirmLabel="忘掉这条"
        danger
        onConfirm={() => {
          if (confirming) void forget(confirming);
          setConfirming(null);
        }}
      />
      {toast && <Toast open text={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
