/**
 * 额度（规范 §7.4.6，锚点 `#quota`）。数字只有一个来源：`GET /api/quota`（lib/quota.ts）。
 * 拿不到就明说「额度暂时看不到」并给一个"再试一次"——**绝不自己编数字**。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getQuota, QUOTA_KIND_LABELS, type QuotaKind, type QuotaSummary } from "../../lib/quota";
import { Button } from "../ui/Button";
import { m } from "../../i18n";

const KINDS: QuotaKind[] = ["chat", "video", "web", "journal", "surf"];

/**
 * 「下次刷新 12月1日」。这里没有直接用 `lib/quota.ts` 的 `formatResetDate`：
 * 它解构少跳了一位（`[, month, day]` 取到的是年和月），会印出「2026月12日」。
 * lib 不在本任务的写入范围，先在这里按同一契约自己取一次，等 lib 修好再收回。
 */
function isQuota(value: unknown): value is QuotaSummary {
  const quota = value as Partial<QuotaSummary> | null;
  return Boolean(
    quota &&
      typeof quota.total === "number" &&
      typeof quota.used === "number" &&
      typeof quota.remaining === "number" &&
      typeof quota.period?.resetsAt === "string" &&
      typeof quota.breakdown === "object" &&
      quota.breakdown !== null,
  );
}

function resetLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return m.setup.quota.resetDate(Number(match[2]), Number(match[3]));
}

type Phase = { phase: "loading" } | { phase: "ok"; data: QuotaSummary } | { phase: "down" };

export function QuotaMeter() {
  const [state, setState] = useState<Phase>({ phase: "loading" });
  const alive = useRef(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ phase: "loading" });
    const data = await getQuota(signal);
    if (signal?.aborted || !alive.current) return;
    // 形状不对（后端还没上、或代理回了别的东西）也按「拿不到」处理：宁可空着，也不印错数。
    setState(isQuota(data) ? { phase: "ok", data } : { phase: "down" });
  }, []);

  useEffect(() => {
    alive.current = true;
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => {
      alive.current = false;
      ctrl.abort();
    };
  }, [load]);

  if (state.phase === "loading") {
    return <p className="set-quota__loading" role="status">{m.setup.quota.loading}</p>;
  }

  if (state.phase === "down") {
    return (
      <div className="set-state" role="status">
        <p className="set-state__title">{m.setup.quota.downTitle}</p>
        <p className="set-state__desc">{m.setup.quota.downDesc}</p>
        <Button variant="secondary" onClick={() => void load()}>
          {m.setup.quota.retry}
        </Button>
      </div>
    );
  }

  const { data } = state;
  const used = Math.max(data.used, 0);
  const percent = data.total > 0 ? Math.min(100, Math.max(0, (used / data.total) * 100)) : 0;

  return (
    <div className="set-quota" data-low={data.low ? "on" : "off"}>
      <p className="set-quota__main">
        {m.setup.quota.remaining(data.remaining, data.total)}
      </p>
      <div
        className="set-meter"
        role="img"
        aria-label={m.setup.quota.meterLabel(data.used, data.total)}
      >
        <span className="set-meter__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="set-quota__reset">{m.setup.quota.nextReset(resetLabel(data.period.resetsAt))}</p>
      <p className="set-quota__detail">
        {KINDS.map((kind) => `${QUOTA_KIND_LABELS[kind]} ${data.breakdown?.[kind] ?? 0}`).join(" · ")}
      </p>
      {data.low && <p className="set-quota__low">{m.setup.quota.low}</p>}
      <p className="set-quota__hint">{m.setup.quota.hint}</p>
      {data.billing === "off" && <p className="set-quota__hint">{m.setup.quota.billingOff}</p>}
    </div>
  );
}
