/**
 * 记忆页的筛选区（参照 astryx 的 Tabs + SearchField + Selector）：
 * 分类用 ui/Tabs（segmented，和见闻页的类型切换同一个组件，带数量），搜索用 ui/Input + ui/Button，「还作数吗」用 ui/Select，
 * 日期范围用 ui/Dialog 里放月历。
 */
import { useState } from "react";
import { MiniCalendar } from "../diary/MiniCalendar";
import { Button, Dialog, Input, Select, Tabs } from "../ui";
import { EMPTY_FILTERS, GROUPS, type GroupKey, type OwnFilters } from "./types";
import { Glass } from "../pages/Glass";
import "../pages/pages.css";

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
  /** 有筛选 / 搜索时的结果数，用于「找到 12 条」。 */
  resultCount: number | null;
  counts: Record<GroupKey, number>;
};

const ERA = [
  { value: "all", label: "全部状态" },
  { value: "current", label: "现在的" },
  { value: "past", label: "以前的" },
];

function dayText(date: Date | null): string {
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : "";
}

function rangeText(filters: OwnFilters): string {
  if (!filters.from && !filters.to) return "时间不限";
  return `${dayText(filters.from) || "起"} – ${dayText(filters.to) || "今"}`;
}

function DateDialog({ open, onOpenChange, filters, onFilters }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: OwnFilters;
  onFilters: (next: OwnFilters) => void;
}) {
  const [picking, setPicking] = useState<"from" | "to">("from");
  const [month, setMonth] = useState(() => filters.from ?? new Date());
  const pick = (date: Date) => {
    onFilters(picking === "from" ? { ...filters, from: date } : { ...filters, to: date });
    if (picking === "from") setPicking("to");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="哪一段时间"
      description="先点开始的那天，再点结束的那天。"
      footer={
        <>
          <Button variant="ghost" onClick={() => onFilters({ ...filters, from: null, to: null })}>清掉日期</Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>看结果</Button>
        </>
      }
    >
      <div className="mdate">
        <div className="mdate__ends" role="group" aria-label="日期范围的两端">
          <Button variant={picking === "from" ? "primary" : "secondary"} aria-pressed={picking === "from"} onClick={() => setPicking("from")}>
            {dayText(filters.from) || "从哪天"}
          </Button>
          <span aria-hidden>到</span>
          <Button variant={picking === "to" ? "primary" : "secondary"} aria-pressed={picking === "to"} onClick={() => setPicking("to")}>
            {dayText(filters.to) || "到哪天"}
          </Button>
        </div>
        <div className="mdate__cal">
          <MiniCalendar
            month={month}
            value={picking === "from" ? filters.from : filters.to}
            marks={new Set()}
            onMonthChange={setMonth}
            onSelect={pick}
            label={picking === "from" ? "选开始的那天" : "选结束的那天"}
          />
        </div>
      </div>
    </Dialog>
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
  const [dateOpen, setDateOpen] = useState(false);
  const dirty = Boolean(filters.from || filters.to || filters.era !== "all" || query || group !== "all");

  return (
    <div className="mfilters">
      <Tabs
        variant="segmented"
        label="按分类看"
        value={group}
        onValueChange={(value) => onGroup(value as GroupKey)}
        className="mfilters__tabs"
        items={GROUPS.map((item) => ({
          value: item.key,
          label: (
            <>
              {item.label}
              <span className="mfilters__n" aria-label={`${counts[item.key] ?? 0} 条`}>{counts[item.key] ?? 0}</span>
            </>
          ),
        }))}
      />

      <div className="ptool">
        <form
          className="ptool__search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <div className="ptool__input">
            <span className="ptool__glass"><Glass /></span>
            <Input
              id="mem-search"
              aria-label="找找她记得的事"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="找找她记得的事…"
              autoComplete="off"
              enterKeyHint="search"
            />
            {query && (
              <button type="button" className="ptool__clear ui-press ui-focus" aria-label="清掉搜索" onClick={onClearSearch}>
                ✕
              </button>
            )}
          </div>
          <Button type="submit" variant="secondary">找</Button>
        </form>

        <Select
          aria-label="还作数吗"
          value={filters.era}
          onValueChange={(value) => onFilters({ ...filters, era: value as OwnFilters["era"] })}
          options={ERA}
        />
        <Button variant="secondary" onClick={() => setDateOpen(true)} aria-haspopup="dialog">
          {rangeText(filters)}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => { onFilters(EMPTY_FILTERS); onClearAll(); }}>
            清掉筛选
          </Button>
        )}
      </div>

      {resultCount !== null && (
        <p className="ptool__count" role="status">找到 {resultCount} 条</p>
      )}

      <DateDialog open={dateOpen} onOpenChange={setDateOpen} filters={filters} onFilters={onFilters} />
    </div>
  );
}
