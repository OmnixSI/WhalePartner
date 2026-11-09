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
  panelId: string;
};

export function IndexTabs({ value, onChange, panelId }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight"
      ? (index + 1) % TABS.length
      : event.key === "ArrowLeft"
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
    <div className="indextabs" role="tablist" aria-label="日记范围" aria-orientation="horizontal">
      {TABS.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            className="indextabs__tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="indextabs__label">{tab.label}</span>
            <span className="sr-only">按{tab.label}看</span>
          </button>
        );
      })}
    </div>
  );
}
