import { useEffect, useState } from "react";
import { SettingRow } from "./Row";
import { SCALE_MAX } from "./prefs";

type Props = {
  scale: number;
  min: number;
  onConfirm: (scale: number) => void;
};

export function ScaleSetting({ scale, min, onConfirm }: Props) {
  const [draft, setDraft] = useState(scale);
  const dirty = Math.abs(draft - scale) > 0.001;
  const current = Math.round(scale * 100);
  const next = Math.round(draft * 100);

  useEffect(() => setDraft(Math.max(scale, min)), [scale, min]);

  return (
    <SettingRow title="字号" desc={dirty ? `当前 ${current}%，待确认 ${next}%。` : `现在 ${current}%，正文大约 ${Math.round(16 * scale)}px。`} stacked>
      <div className="set-scale">
        <span className="set-scale__end" aria-hidden="true">小Aa</span>
        <input
          type="range"
          className="set-slider"
          aria-label="字号"
          min={min}
          max={SCALE_MAX}
          step={0.05}
          value={draft}
          onChange={(event) => setDraft(Number(event.target.value))}
        />
        <span className="set-scale__end" aria-hidden="true">大Aa</span>
      </div>
      <div className="set-scale__confirm">
        <p className="set-scale__preview" style={{ fontSize: `${Math.round(18 * draft)}px` }}>
          预览：今天天气很好
        </p>
        <button type="button" className="btn btn--secondary" disabled={!dirty} onClick={() => onConfirm(draft)}>
          确认
        </button>
      </div>
    </SettingRow>
  );
}
