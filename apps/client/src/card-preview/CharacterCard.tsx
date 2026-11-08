import type { PointerEvent } from "react";
import { CharacterMark } from "../components/CharacterMark";
import type { CardCharacter } from "./data";

type Props = {
  character: CardCharacter;
  index: number;
  selected: boolean;
  effectLevel: number;
  effectLabel: string;
  onSelect: () => void;
};

function modelName(character: CardCharacter) {
  return character.model?.label ?? "固定矢量默认形象";
}

function updateAngle(event: PointerEvent<HTMLButtonElement>, effectLevel: number) {
  if (effectLevel < 2) {
    resetAngle(event);
    return;
  }
  if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  event.currentTarget.style.setProperty("--tilt-x", `${-y * 6}deg`);
  event.currentTarget.style.setProperty("--tilt-y", `${x * 8}deg`);
}

function resetAngle(event: PointerEvent<HTMLButtonElement>) {
  event.currentTarget.style.setProperty("--tilt-x", "0deg");
  event.currentTarget.style.setProperty("--tilt-y", "0deg");
}

export function CharacterCard({ character, index, selected, effectLevel, effectLabel, onSelect }: Props) {
  const model = modelName(character);
  const aria = `选择${character.name}，${model}，卡面等级${effectLevel}，${effectLabel}`;

  return (
    <button
      type="button"
      className="card-preview__card"
      data-character={character.id}
      data-level={effectLevel}
      data-selected={selected ? "true" : "false"}
      data-foil={selected && effectLevel === 5 ? "true" : "false"}
      aria-pressed={selected}
      aria-label={aria}
      onClick={onSelect}
      onPointerMove={(event) => updateAngle(event, effectLevel)}
      onPointerLeave={resetAngle}
      onPointerCancel={resetAngle}
    >
      <span className="card-preview__underlay card-preview__underlay--back" aria-hidden="true" />
      <span className="card-preview__underlay card-preview__underlay--front" aria-hidden="true" />
      <span className="card-preview__face">
        <span className="card-preview__shine" aria-hidden="true" />
        <span className="card-preview__card-top">
          <span className="card-preview__index">No.{String(index + 1).padStart(2, "0")}</span>
          <span className="card-preview__seal">{selected ? "已选" : "鲸汐角色"}</span>
        </span>
        <span className="card-preview__art">
          <CharacterMark character={character.id} className="card-preview__mark" />
          <span className="card-preview__card-name">{character.name}</span>
          <span className="card-preview__latin">{character.latin}</span>
        </span>
        <span className="card-preview__card-bottom">
          <span className="card-preview__model">{model}</span>
          <span className="card-preview__rarity">
            Lv.{effectLevel} · {effectLabel}
          </span>
        </span>
      </span>
    </button>
  );
}
