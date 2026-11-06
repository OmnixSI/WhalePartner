/**
 * IndexTabs（规范 §6.10）：手帐侧边分页标签，贴在日记本右缘外侧。
 *
 * 桌面竖排（周 / 月 / 年，每枚 44×72，选中向外探出 8px），手机横排贴顶部。
 * `role="tablist"` + 方向键切换（← → 在横排、↑ ↓ 在竖排都会走同一条顺序），
 * 全部 tab 指向同一个面板 `#diary-panel`（面板内容不随 tab 卸载，只换密度）。
 */
import { useRef, type KeyboardEvent } from "react";
import type { RangeMode } from "./types";

const TABS: Array<{ value: RangeMode; label: string }> = [
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" },
];

type Props = {
  value: RangeMode;
  onChange: (mode: RangeMode) => void;
  vertical: boolean;
  panelId: string;
};

export function IndexTabs({ value, onChange, vertical, panelId }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(TABS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className="indextabs" role="tablist" aria-label="日记范围" aria-orientation={vertical ? "vertical" : "horizontal"} data-orientation={vertical ? "vertical" : "horizontal"}>
      {TABS.map((tab, i) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            className="indextabs__tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            <span className="indextabs__label">{tab.label}</span>
            <span className="sr-only">按{tab.label}看</span>
          </button>
        );
      })}
    </div>
  );
}
