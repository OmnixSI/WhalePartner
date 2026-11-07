/**
 * 见闻筛选：类型（全部/视频/网页）、来源（B 站、各个网站）、日期（今天/近 7 天/近 30 天/选一天）。
 * 全是受控的纯展示组件，状态在页面里；来源列表来自接口的 `sources`。
 */
import type { DateRange, SurfKind, SurfSource } from "../../lib/surf";
import { siteLabel } from "../../lib/surf";

const KINDS: Array<{ value: SurfKind | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "web", label: "网页" },
];

const RANGES: Array<{ value: DateRange; label: string }> = [
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

export function SurfFilters({ kind, site, range, day, sources, onKind, onSite, onRange, onDay }: Props) {
  return (
    <div className="surf-filters">
      <div className="surf-chips" role="group" aria-label="按类型看她带回来的东西">
        {KINDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="surf-chip"
            aria-pressed={kind === entry.value}
            data-on={kind === entry.value ? "on" : "off"}
            onClick={() => onKind(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <label className="surf-select">
        <span className="surf-select__label">来源</span>
        <select className="field surf-select__field" value={site} aria-label="按来源筛选" onChange={(event) => onSite(event.target.value)}>
          <option value="">全部来源</option>
          {sources.map((source) => (
            <option key={source.site} value={source.site}>
              {siteLabel(source.site)}（{source.count}）
            </option>
          ))}
        </select>
      </label>

      <div className="surf-range">
        <div className="surf-chips" role="group" aria-label="按日期筛选">
          {RANGES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className="surf-chip surf-chip--soft"
              aria-pressed={range === entry.value}
              data-on={range === entry.value ? "on" : "off"}
              onClick={() => onRange(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {range === "day" && (
          <input
            className="field surf-range__day"
            type="date"
            value={day}
            aria-label="选一天"
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => onDay(event.target.value)}
          />
        )}
      </div>
    </div>
  );
}
