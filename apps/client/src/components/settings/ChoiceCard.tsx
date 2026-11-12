/**
 * 单选项：一小块可点的卡，选中 = 强调色描边 + 底色。不做下拉列表。
 * 用 `aria-pressed` 表示选中，读屏按「按钮，已按下」读。
 */
import type { ReactNode } from "react";

type Props = {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
  /** 缩略/示意区（装饰，读屏跳过） */
  preview?: ReactNode;
  /** 组内读屏用的统一说明，例如「外观」 */
  groupLabel?: string;
};

export function ChoiceCard({ label, hint, selected, onSelect, preview, groupLabel }: Props) {
  return (
    <button
      type="button"
      className="set-choice ui-press ui-focus"
      aria-pressed={selected}
      aria-label={groupLabel ? `${groupLabel}：${label}` : undefined}
      data-selected={selected ? "on" : "off"}
      onClick={onSelect}
    >
      {preview && (
        <span className="set-choice__preview" aria-hidden="true">
          {preview}
        </span>
      )}
      <span className="set-choice__label">{label}</span>
      {hint && <span className="set-choice__hint">{hint}</span>}
    </button>
  );
}
