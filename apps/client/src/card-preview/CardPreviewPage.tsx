import { useState } from "react";
import { ADVANCED_EFFECT_LEVEL, CARD_CHARACTERS, RELATIONSHIP_SAMPLES } from "./data";
import { CharacterCard } from "./CharacterCard";
import "./card-preview.css";

export function CardPreviewPage() {
  const [selectedId, setSelectedId] = useState("deepseek");
  const [sampleIdx, setSampleIdx] = useState(0);
  const [foilEnabled, setFoilEnabled] = useState(false);
  const sample = RELATIONSHIP_SAMPLES[sampleIdx];
  const selected = CARD_CHARACTERS.find((character) => character.id === selectedId) ?? CARD_CHARACTERS[0];
  const advancedUnlocked = sampleIdx >= ADVANCED_EFFECT_LEVEL;
  const progress = sampleIdx === RELATIONSHIP_SAMPLES.length - 1
    ? 100
    : Math.round((sample.points / sample.next) * 100);

  const chooseSample = (idx: number) => {
    setSampleIdx(idx);
    if (idx < ADVANCED_EFFECT_LEVEL) setFoilEnabled(false);
  };

  return (
    <main className="card-preview-page">
      <header className="card-preview__header">
        <div>
          <p className="card-preview__eyebrow">WHALEPARTNER · CHARACTER COLLECTION</p>
          <h1>角色闪卡</h1>
          <p className="card-preview__lead">选一位陪你。卡面会随关系进度展现不同的纸上光泽。</p>
        </div>
        <span className="card-preview__demo">独立预览 · 演示数据</span>
      </header>

      <section className="card-preview__controls" aria-label="闪卡预览控制">
        <div className="card-preview__relationship">
          <div className="card-preview__relationship-head">
            <div>
              <p className="card-preview__section-label">关系进度样本</p>
              <p className="card-preview__level">{sample.label}<span>{sample.points} 点</span></p>
            </div>
            <span className="card-preview__demo-note">固定演示值，不代表真实账号</span>
          </div>
          <div
            className="card-preview__progress"
            role="progressbar"
            aria-label="演示关系进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="card-preview__samples" role="group" aria-label="切换关系进度演示">
            {RELATIONSHIP_SAMPLES.map((item, idx) => (
              <button
                key={item.label}
                type="button"
                className="card-preview__sample"
                aria-pressed={idx === sampleIdx}
                onClick={() => chooseSample(idx)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-preview__effect-control">
          <p className="card-preview__section-label">卡面效果</p>
          <p className="card-preview__effect-copy">
            {advancedUnlocked ? "默契阶段已解锁细闪效果。" : "基础角色照常可选；默契阶段解锁细闪效果。"}
          </p>
          <button
            type="button"
            className="btn btn--secondary card-preview__effect-button"
            disabled={!advancedUnlocked}
            aria-pressed={foilEnabled}
            onClick={() => setFoilEnabled((value) => !value)}
          >
            {advancedUnlocked ? (foilEnabled ? "关闭细闪" : "预览细闪") : "细闪未解锁"}
          </button>
        </div>
      </section>

      <section className="card-preview__collection" aria-labelledby="card-list-title">
        <div className="card-preview__collection-head">
          <div>
            <p className="card-preview__section-label">角色牌库</p>
            <h2 id="card-list-title">四位角色，各有默认形象</h2>
          </div>
          <span className="card-preview__count">{CARD_CHARACTERS.length} 张</span>
        </div>
        <div className="card-preview__grid">
          {CARD_CHARACTERS.map((character, idx) => (
            <CharacterCard
              key={character.id}
              character={character}
              index={idx}
              selected={character.id === selected.id}
              advancedUnlocked={advancedUnlocked}
              advancedActive={foilEnabled}
              onSelect={() => setSelectedId(character.id)}
            />
          ))}
        </div>
      </section>

      <section className="card-preview__selected" aria-live="polite">
        <div className="card-preview__selected-copy">
          <p className="card-preview__section-label">预览中的选择</p>
          <h2>{selected.name}<span>{selected.model?.label ?? "固定矢量默认形象"}</span></h2>
          <p>{selected.model ? "当前唯一已接入的 Live2D 模型归大肥鱼所有。" : "此人格保持自己的默认徽记；目前没有可用的额外 Live2D 模型。"}</p>
        </div>
        <p className="card-preview__notice">只更改本页演示选择，不会切换应用角色或写入业务数据。</p>
      </section>
      <footer className="card-preview__footer">高阶效果只改变卡面表现，不会锁定角色、形象或正常聊天。</footer>
    </main>
  );
}
