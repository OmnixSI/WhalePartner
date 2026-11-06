/**
 * 选项卡（规范 §7.4.2「看起来」「逛的频率」、§7.5 第 3 步字号）：
 * 160×112 的纸片，选中 = 2.5px 强调色框 + 「已选」邮戳；不做下拉列表。
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
      className="set-choice"
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
      {selected && <span className="set-choice__stamp">已选</span>}
    </button>
  );
}
