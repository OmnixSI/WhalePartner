/**
 * 额度（规范 §7.4.6，锚点 `#quota`）。数字只有一个来源：`GET /api/quota`（lib/quota.ts）。
 * 拿不到就明说「额度暂时看不到」并给一个"再试一次"——**绝不自己编数字**。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getQuota, QUOTA_KIND_LABELS, type QuotaKind, type QuotaSummary } from "../../lib/quota";
import { Button } from "../ui/Button";

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
  return `${Number(match[2])}月${Number(match[3])}日`;
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
    return <p className="set-quota__loading" role="status">正在数贝壳…</p>;
  }

  if (state.phase === "down") {
    return (
      <div className="set-state" role="status">
        <p className="set-state__title">额度暂时看不到</p>
        <p className="set-state__desc">贝壳数只从服务里读；现在拿不到，就不猜一个数给你。</p>
        <Button variant="secondary" onClick={() => void load()}>
          再试一次
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
        本月还剩 <strong>{data.remaining}</strong> / {data.total} 个贝壳
      </p>
      <div
        className="set-meter"
        role="img"
        aria-label={`已经用了 ${data.used} 个，一共 ${data.total} 个`}
      >
        <span className="set-meter__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="set-quota__reset">下次刷新 {resetLabel(data.period.resetsAt)}</p>
      <p className="set-quota__detail">
        {KINDS.map((kind) => `${QUOTA_KIND_LABELS[kind]} ${data.breakdown?.[kind] ?? 0}`).join(" · ")}
      </p>
      {data.low && <p className="set-quota__low">快用完了，她逛街会先歇着。</p>}
      <p className="set-quota__hint">用多少、什么时候扣，都会写在这里，不会悄悄扣。</p>
      {data.billing === "off" && <p className="set-quota__hint">现在还不收费，这里只是让你心里有数。</p>}
    </div>
  );
}
