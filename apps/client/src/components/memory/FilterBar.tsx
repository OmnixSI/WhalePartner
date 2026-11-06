/**
 * 筛选条（规范 §7.3.6）：搜索框 + 五组海边小物分类 + 「更多筛选」。
 *
 * - 搜索：`Field` + 放大镜 +「找」；清除是右侧 ✕（44px 命中区）。
 * - 分类芯片手机横滚、每个 ≥44 高；选中用 `--accent-wash` 底 + `--accent` 字。
 * - 「更多筛选」：桌面 Popover、手机底部 Sheet。只放**真能筛**的四项里的三项：
 *   谁说的 / 哪位角色需要后端字段，这一版接口没有，等 B4 补上再加，不摆空壳。
 */
import { Dialog, Popover } from "radix-ui";
import { useState } from "react";
import { Icon } from "../ink-icons";
import { useMediaQuery } from "../chat/useViewport";
import { MiniCalendar } from "../diary/MiniCalendar";
import { EMPTY_FILTERS, GROUPS, filterActive, type GroupKey, type OwnFilters } from "./types";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  onSearch: () => void;
  onClearSearch: () => void;
  group: GroupKey;
  onGroup: (group: GroupKey) => void;
  filters: OwnFilters;
  onFilters: (next: OwnFilters) => void;
  onClearAll: () => void;
  /** 有筛选 / 搜索时的结果数，用于「找到 12 件」。 */
  resultCount: number | null;
  counts: Record<GroupKey, number>;
};

const ERA: Array<{ value: OwnFilters["era"]; label: string }> = [
  { value: "all", label: "都看" },
  { value: "current", label: "现在的" },
  { value: "past", label: "以前的" },
];

function dayText(date: Date | null, fallback: string): string {
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : fallback;
}

function FilterPanel({
  filters,
  onFilters,
  onClear,
  onDone,
}: {
  filters: OwnFilters;
  onFilters: (next: OwnFilters) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [month, setMonth] = useState(() => filters.from ?? new Date());

  const pick = (date: Date) => {
    if (picking === "from") onFilters({ ...filters, from: date });
    if (picking === "to") onFilters({ ...filters, to: date });
    setPicking(null);
  };

  return (
    <div className="mfilt">
      <p className="mfilt__group" id="mfilt-when">
        哪一段时间
      </p>
      <div className="mfilt__row">
        <button
          type="button"
          className="field mfilt__date"
          aria-describedby="mfilt-when"
          aria-expanded={picking === "from"}
          onClick={() => setPicking(picking === "from" ? null : "from")}
        >
          {dayText(filters.from, "从哪天")}
        </button>
        <span className="mfilt__to" aria-hidden>
          到
        </span>
        <button
          type="button"
          className="field mfilt__date"
          aria-describedby="mfilt-when"
          aria-expanded={picking === "to"}
          onClick={() => setPicking(picking === "to" ? null : "to")}
        >
          {dayText(filters.to, "到哪天")}
        </button>
      </div>

      {picking && (
        <MiniCalendar
          month={month}
          value={picking === "from" ? filters.from : filters.to}
          marks={new Set()}
          onMonthChange={setMonth}
          onSelect={pick}
          label={picking === "from" ? "选开始的那天" : "选结束的那天"}
        />
      )}

      <p className="mfilt__group" id="mfilt-era">
        还作数吗
      </p>
      <div className="mfilt__seg" role="group" aria-labelledby="mfilt-era">
        {ERA.map((item) => (
          <button
            key={item.value}
            type="button"
            className="mfilt__segbtn"
            aria-pressed={filters.era === item.value}
            onClick={() => onFilters({ ...filters, era: item.value })}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mfilt__actions">
        <button type="button" className="btn btn--quiet" onClick={onClear}>
          清掉筛选
        </button>
        <button type="button" className="btn btn--primary" onClick={onDone}>
          看结果
        </button>
      </div>
    </div>
  );
}

export function FilterBar({
  query,
  onQuery,
  onSearch,
  onClearSearch,
  group,
  onGroup,
  filters,
  onFilters,
  onClearAll,
  resultCount,
  counts,
}: Props) {
  const wide = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const dirty = filterActive(filters);

  const panel = (
    <FilterPanel
      filters={filters}
      onFilters={onFilters}
      onClear={() => onFilters(EMPTY_FILTERS)}
      onDone={() => setOpen(false)}
    />
  );

  return (
    <div className="fbar">
      <form
        className="fbar__search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
        role="search"
      >
        <span className="fbar__glass" aria-hidden>
          {/* 图标集里没有放大镜：这里画一个，24 网格、跟手绘图标同笔宽 */}
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.2" />
            <path d="M15.2 15.4l4.4 4.2" />
          </svg>
        </span>
        <label className="sr-only" htmlFor="mem-search">
          找找她记得的事
        </label>
        <input
          id="mem-search"
          className="field fbar__input"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="找找她记得的事…"
          autoComplete="off"
          enterKeyHint="search"
        />
        {query && (
          <button type="button" className="fbar__clear" aria-label="清掉搜索" onClick={onClearSearch}>
            ✕
          </button>
        )}
        <button type="submit" className="btn btn--secondary fbar__go">
          找
        </button>
      </form>

      <div className="fbar__chips" role="group" aria-label="按分类看">
        {GROUPS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="fbar__chip"
            aria-pressed={group === item.key}
            onClick={() => onGroup(item.key)}
          >
            <span className="fbar__chipicon" aria-hidden>
              <Icon name={item.icon} size={20} />
            </span>
            {item.label}
            <span className="fbar__chipcount" aria-hidden>
              {counts[item.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="fbar__more">
        {wide ? (
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger className="btn btn--quiet fbar__morebtn" aria-expanded={open}>
              更多筛选 {dirty ? "· 已筛" : ""} <span aria-hidden>▾</span>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="pop fbar__pop" sideOffset={8} align="start">
                {panel}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger className="btn btn--quiet fbar__morebtn" aria-expanded={open}>
              更多筛选 {dirty ? "· 已筛" : ""} <span aria-hidden>▾</span>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="overlay" />
              <Dialog.Content className="mfilt__sheet">
                <Dialog.Title className="mfilt__sheettitle">更多筛选</Dialog.Title>
                <Dialog.Close className="btn btn--quiet mfilt__sheetclose">
                  收起
                </Dialog.Close>
                {panel}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
        {(dirty || group !== "all") && (
          <button type="button" className="btn btn--quiet" onClick={onClearAll}>
            清掉筛选
          </button>
        )}
      </div>

      {resultCount !== null && (
        <p className="fbar__count" role="status">
          找到 {resultCount} 件
        </p>
      )}
    </div>
  );
}
