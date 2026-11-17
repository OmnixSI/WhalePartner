/**
 * 见闻筛选工具条（参照 astryx 的 SegmentedControl + Selector）：
 * 类型用 ui/Tabs（segmented），来源和日期用 ui/Select，选一天时再出一个 ui/Input 日期框。
 * 全是受控的纯展示组件，状态在页面里；来源列表来自接口的 `sources`。
 */
import type { DateRange, SurfKind, SurfSource } from "../../lib/surf";
import { localDay, siteLabel } from "../../lib/surf";
import { Input, Select, Tabs } from "../ui";
import { m } from "../../i18n";

const KINDS = [
  { value: "all", label: m.surf.filters.kindAll },
  { value: "video", label: m.surf.filters.kindVideo },
  { value: "web", label: m.surf.filters.kindWeb },
];

const RANGES = [
  { value: "all", label: m.surf.filters.rangeAll },
  { value: "today", label: m.surf.filters.rangeToday },
  { value: "week", label: m.surf.filters.rangeWeek },
  { value: "month", label: m.surf.filters.rangeMonth },
  { value: "day", label: m.surf.filters.rangeDay },
];

type Props = {
  kind: SurfKind | "all";
  site: string;
  range: DateRange;
  day: string;
  sources: SurfSource[];
  onKind: (kind: SurfKind | "all") => void;
  onSite: (site: string) => void;
  onRange: (range: DateRange) => void;
  onDay: (day: string) => void;
};

const ALL_SITES = "__all__";

export function SurfFilters({ kind, site, range, day, sources, onKind, onSite, onRange, onDay }: Props) {
  return (
    <div className="surf-filters">
      <Tabs
        variant="segmented"
        label={m.surf.filters.kindLabel}
        value={kind}
        onValueChange={(value) => onKind(value as SurfKind | "all")}
        items={KINDS}
      />
      <Select
        aria-label={m.surf.filters.siteAria}
        value={site || ALL_SITES}
        onValueChange={(value) => onSite(value === ALL_SITES ? "" : value)}
        options={[
          { value: ALL_SITES, label: m.surf.filters.allSites },
          ...sources.map((source) => ({ value: source.site, label: m.surf.filters.siteOption(siteLabel(source.site), source.count) })),
        ]}
      />
      <Select
        aria-label={m.surf.filters.dateAria}
        value={range}
        onValueChange={(value) => onRange(value as DateRange)}
        options={RANGES}
      />
      {range === "day" && (
        <Input
          className="surf-filters__day"
          type="date"
          value={day}
          aria-label={m.surf.filters.dayAria}
          max={localDay()}
          onChange={(event) => onDay(event.target.value)}
        />
      )}
    </div>
  );
}
