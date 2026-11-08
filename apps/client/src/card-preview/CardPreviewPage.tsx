import { useEffect, useState } from "react";
import { CARD_CHARACTERS, RELATIONSHIP_SAMPLES } from "./data";
import { CharacterCard } from "./CharacterCard";
import { CardShowcase } from "./CardShowcase";
import "./card-preview.css";

export function CardPreviewPage() {
  const [selectedId, setSelectedId] = useState("deepseek");
  const [sampleIdx, setSampleIdx] = useState(3);
  const sample = RELATIONSHIP_SAMPLES[sampleIdx];
  const selected = CARD_CHARACTERS.find((character) => character.id === selectedId) ?? CARD_CHARACTERS[0];
  const progress = sampleIdx === RELATIONSHIP_SAMPLES.length - 1 ? 100 : 0;

  useEffect(() => {
    document.documentElement.setAttribute("data-character", selected.id);
  }, [selected.id]);

  return (
    <main className="card-preview-page">
      <header className="card-preview__header">
        <div>
          <p className="card-preview__eyebrow">WHALEPARTNER · CHARACTER COLLECTION</p>
          <h1>角色闪卡</h1>
          <p className="card-preview__lead">好感越深，卡面越完整。从立体视差、动态画面，到专属光环与星芒。移动指针或手指倾斜卡面，查看人物分层与光影变化。</p>
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
          <div className="card-preview__samples" role="group" aria-label="切换好感度与卡面等级演示">
            {RELATIONSHIP_SAMPLES.map((item, idx) => (
              <button
                key={item.label}
                type="button"
                className="card-preview__sample"
                aria-label={`预览等级 ${item.level}：${item.label}`}
                aria-pressed={idx === sampleIdx}
                onClick={() => setSampleIdx(idx)}
              >
                Lv.{item.level} {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-preview__effect-control">
          <p className="card-preview__section-label">卡面效果</p>
          <p className="card-preview__effect-copy">Lv.{sample.level} · {sample.effect}<br />{sample.detail}</p>
          <p className="card-preview__effect-next">
            {RELATIONSHIP_SAMPLES[sampleIdx + 1]
              ? `下一阶：${RELATIONSHIP_SAMPLES[sampleIdx + 1].effect} · 待解锁`
              : "最高级专属特效已解锁"}
          </p>
        </div>
      </section>

      <CardShowcase
        character={selected}
        sample={sample}
      />

      <section className="card-preview__collection" aria-labelledby="card-list-title">
        <div className="card-preview__collection-head">
          <div>
            <p className="card-preview__section-label">角色牌库</p>
            <h2 id="card-list-title">四位角色，各有默认形象</h2>
          </div>
          <span className="card-preview__count">{CARD_CHARACTERS.length} 张</span>
        </div>
        <div className="card-preview__grid">
          {CARD_CHARACTERS.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              selected={character.id === selected.id}
              effectLevel={sample.level}
              effectLabel={sample.effect}
              onSelect={() => setSelectedId(character.id)}
            />
          ))}
        </div>
      </section>

      <footer className="card-preview__footer">低等级只展示基础卡面，不会锁定角色或默认形象；当前 Live2D 仍只归大肥鱼。所有点数均为固定演示数据。</footer>
    </main>
  );
}
