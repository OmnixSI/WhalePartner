/**
 * 「她的见闻」页（规范 §7.7.4）：按天分组的剪报墙 + 筛选 + 「让她现在去逛逛」。
 *
 * 数据纪律：不编内容。接口不在 / 出错就进错误态；今天什么都没逛到就是空态；
 * 服务端说 429（刚回来不久）就把那句原话摆出来。
 * 她的进度靠 `useSurfEvents` 的 SSE 推过来，页不可见时断开、回来先对齐一次状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/shell/PageHeader";
import { Glass } from "../components/pages/Glass";
import { StatePanel } from "../components/pages/StatePanel";
import { SurfCard } from "../components/surf/SurfCard";
import { SurfFilters } from "../components/surf/SurfFilters";
import { SurfDetail } from "../components/surf/SurfDetail";
import { Button, ConfirmDialog, Input } from "../components/ui";
import { toast } from "../components/ui/toast-store";
import { SurfStatus, type SurfPhase } from "../components/surf/SurfStatus";
import { useHubRefresh } from "../lib/useHubRefresh";
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
  localDay,
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
import { m } from "../i18n";

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
  const [detail, setDetail] = useState<SurfFeedItem | null>(null);
  const [confirming, setConfirming] = useState<SurfFeedItem | null>(null);
  const [busy, setBusy] = useState(false);

  const openSourceUrl = (url: string) => {
    void openExternalUrl(url).catch((cause: unknown) => {
      console.warn("Could not open surf source URL", cause);
      toast({ title: m.surf.page.openLinkFailedTitle, description: cause instanceof Error ? cause.message : m.surf.page.openLinkFailedDesc, tone: "error" });
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
        setError(cause instanceof Error ? cause.message : m.surf.page.loadFailed);
        setState("error");
      }
    },
    [character.id, kind, applied, site, range, day],
  );

  const refreshStatus = useCallback(async () => {
    const next = await getSurfStatus(character.id);
    if (!next) return;
    setStatus(next);
    // 页面藏起来时错过了「逛完了」的事件：状态说她没在逛，就别一直停在「她正在逛…」。
    if (!next.running) setBusy(false);
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

  // 另一台设备上的她逛到了新东西：hub 的 surf.item 事件到这里也重拉第一页。
  useHubRefresh(["surf.item"], () => void load(1, { silent: true }));

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
      toast({ title: m.surf.page.goingOut });
      void refreshStatus();
      return;
    }
    setBusy(false);
    if (answer.code === "too_soon") toast({ title: answer.message ?? m.surf.page.tooSoon, tone: "warning" });
    else if (answer.code === "already_running") toast({ title: m.surf.page.alreadyRunning });
    else if (answer.code === "quota") toast({ title: m.surf.page.quotaLow, tone: "warning" });
    else toast({ title: answer.message ?? m.surf.page.cannotCall, tone: "error" });
  };

  const enableBack = async () => {
    try {
      const saved = await putSurfSettings(character.id, { enabled: true });
      setStatus((prev) => (prev ? { ...prev, pausedReason: null } : prev));
      toast({ title: m.surf.page.enabledBack, tone: "success" });
      void saved;
      void refreshStatus();
    } catch {
      toast({ title: m.surf.page.cannotChangeSettings, tone: "error" });
    }
  };

  const forget = async (item: SurfFeedItem) => {
    try {
      await deleteSurfItem(item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      setTotal((prev) => Math.max(0, prev - 1));
      toast({ title: m.surf.page.forgotten });
    } catch {
      toast({ title: m.surf.page.cannotForget, tone: "error" });
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
        <PageHeader
          title={m.surf.page.title(character.name)}
          meta={
            status
              ? disabled
                ? m.surf.page.metaDisabled
                : m.surf.page.metaToday(status.todayCount, nextRunText(status))
              : m.surf.page.metaLoading
          }
          actions={<SurfStatus phase={phase} onDismiss={() => setPhase(null)} />}
        />

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
              if (next === "day" && !day) setDay(localDay());
              setPage(1);
            }}
            onDay={(next) => {
              setDay(next);
              setPage(1);
            }}
          />

          <form
            className="ptool__search surf-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(query);
              setPage(1);
            }}
          >
            <div className="ptool__input">
              <span className="ptool__glass"><Glass /></span>
              <Input
                type="search"
                value={query}
                placeholder={m.surf.page.searchPlaceholder}
                aria-label={m.surf.page.searchAria}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button type="submit" variant="secondary">{m.surf.page.searchButton}</Button>
          </form>

          <Button
            variant="primary"
            className="surf-run"
            onClick={() => void trigger()}
            disabled={running || disabled}
            loading={running}
          >
            {running ? m.surf.page.running : m.surf.page.runNow}
          </Button>
        </div>

        {state === "error" ? (
          <StatePanel kind="error" title={m.surf.page.errorTitle} body={m.surf.page.errorBody} detail={error}>
            <Button variant="primary" onClick={() => void load(1)}>{m.surf.page.retry}</Button>
          </StatePanel>
        ) : state === "loading" ? (
          <StatePanel kind="loading" title={m.surf.page.loadingTitle} />
        ) : items.length === 0 ? (
          applied.trim() ? (
            <StatePanel
              kind="empty"
              icon="newspaper"
              title={m.surf.page.noMatchTitle(applied.trim())}
              body={m.surf.page.noMatchBody}
            >
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setApplied("");
                  setPage(1);
                }}
              >
                {m.surf.page.clearSearch}
              </Button>
            </StatePanel>
          ) : filtered ? (
            <StatePanel kind="empty" icon="newspaper" title={m.surf.page.filteredEmptyTitle} body={m.surf.page.filteredEmptyBody}>
              <Button variant="secondary" onClick={clearFilters}>{m.surf.page.clearFilters}</Button>
            </StatePanel>
          ) : lowQuota ? (
            <StatePanel kind="empty" icon="conch" title={m.surf.page.quotaTitle} body={m.surf.page.quotaBody}>
              <Button variant="secondary" onClick={() => window.location.assign("/settings#quota")}>{m.surf.page.viewQuota}</Button>
            </StatePanel>
          ) : disabled ? (
            <StatePanel kind="empty" icon="lighthouse" title={m.surf.page.disabledTitle} body={m.surf.page.disabledBody}>
              <Button variant="primary" onClick={() => void enableBack()}>{m.surf.page.enable}</Button>
            </StatePanel>
          ) : (
            <StatePanel kind="empty" icon="phone" title={m.surf.page.neverTitle} body={m.surf.page.neverBody}>
              <Button variant="primary" onClick={() => void trigger()}>{m.surf.page.runNow}</Button>
            </StatePanel>
          )
        ) : (
          <>
            {groups.map(([label, list]) => (
              <section className="surf-day" key={label} aria-label={label}>
                <h2 className="surf-day__date">
                  <span className="surf-day__text">{label}</span>
                  <span className="surf-day__count">{m.surf.page.dayCount(list.length)}</span>
                </h2>
                <ul className="surf-grid">
                  {list.map((item) => (
                    <SurfCard
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
                <Button variant="secondary" onClick={() => void load(page + 1, { append: true })}>
                  {m.surf.page.loadMore}
                </Button>
              </div>
            ) : (
              <p className="surf-end">{m.surf.page.end}</p>
            )}
          </>
        )}
      </div>

      <SurfDetail item={detail} onClose={() => setDetail(null)} onForget={setConfirming} onOpenUrl={openSourceUrl} />
      <ConfirmDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={m.surf.page.forgetTitle(confirming?.title ?? "")}
        description={m.surf.page.forgetDesc}
        cancelLabel={m.surf.page.forgetCancel}
        confirmLabel={m.surf.page.forgetConfirm}
        tone="danger"
        onConfirm={() => {
          if (confirming) void forget(confirming);
          setConfirming(null);
        }}
      />
    </div>
  );
}
