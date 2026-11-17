import { useEffect, useState } from "react";
import { SettingRow } from "./Row";
import { SCALE_MAX } from "./prefs";
import { Button } from "../ui/Button";
import { m } from "../../i18n";

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
    <SettingRow title={m.settings.scale.title} desc={dirty ? m.settings.scale.pending(current, next) : m.settings.scale.now(current, Math.round(16 * scale))} stacked>
      <div className="set-scale">
        <span className="set-scale__end" aria-hidden="true">{m.settings.scale.small}</span>
        <input
          type="range"
          className="set-slider"
          aria-label={m.settings.scale.title}
          min={min}
          max={SCALE_MAX}
          step={0.05}
          value={draft}
          onChange={(event) => setDraft(Number(event.target.value))}
        />
        <span className="set-scale__end" aria-hidden="true">{m.settings.scale.large}</span>
      </div>
      <div className="set-scale__confirm">
        <p className="set-scale__preview" style={{ fontSize: `${Math.round(18 * draft)}px` }}>
          {m.settings.scale.preview}
        </p>
        <Button variant="secondary" disabled={!dirty} onClick={() => onConfirm(draft)}>
          {m.settings.scale.confirm}
        </Button>
      </div>
    </SettingRow>
  );
}
