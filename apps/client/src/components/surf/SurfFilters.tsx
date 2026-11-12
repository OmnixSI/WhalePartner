/**
 * 见闻筛选工具条（参照 astryx 的 SegmentedControl + Selector）：
 * 类型用 ui/Tabs（segmented），来源和日期用 ui/Select，选一天时再出一个 ui/Input 日期框。
 * 全是受控的纯展示组件，状态在页面里；来源列表来自接口的 `sources`。
 */
import type { DateRange, SurfKind, SurfSource } from "../../lib/surf";
import { localDay, siteLabel } from "../../lib/surf";
import { Input, Select, Tabs } from "../ui";

const KINDS = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "web", label: "网页" },
];

const RANGES = [
  { value: "all", label: "不限时间" },
  { value: "today", label: "今天" },
  { value: "week", label: "近 7 天" },
  { value: "month", label: "近 30 天" },
  { value: "day", label: "选一天" },
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
        label="按类型看她带回来的东西"
        value={kind}
        onValueChange={(value) => onKind(value as SurfKind | "all")}
        items={KINDS}
      />
      <Select
        aria-label="按来源筛选"
        value={site || ALL_SITES}
        onValueChange={(value) => onSite(value === ALL_SITES ? "" : value)}
        options={[
          { value: ALL_SITES, label: "全部来源" },
          ...sources.map((source) => ({ value: source.site, label: `${siteLabel(source.site)}（${source.count}）` })),
        ]}
      />
      <Select
        aria-label="按日期筛选"
        value={range}
        onValueChange={(value) => onRange(value as DateRange)}
        options={RANGES}
      />
      {range === "day" && (
        <Input
          className="surf-filters__day"
          type="date"
          value={day}
          aria-label="选一天"
          max={localDay()}
          onChange={(event) => onDay(event.target.value)}
        />
      )}
    </div>
  );
}
