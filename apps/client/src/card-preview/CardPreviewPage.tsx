import { useEffect, useState } from "react";
import type { CharacterId } from "../characters";
import { applyTheme } from "../lib/theme";
import { AffinityCard, type UpgradeEnd } from "./tier/AffinityCard";
import { CARD_TIERS, tierOf, type CardLevel } from "./tier/tiers";
import "./card-preview.css";

/**
 * 独立预览页（character-cards.html）：五档卡面、四位角色、四段升级动画。
 * 不读接口、不写 wp.character；分数和等级只是固定演示数据。
 */
const PREVIEW_CHARACTERS: ReadonlyArray<{ id: CharacterId; name: string }> = [
  { id: "whale", name: "鲸汐" },
  { id: "deepseek", name: "大肥鱼" },
  { id: "claude", name: "小克" },
  { id: "chatgpt", name: "小智" },
];

const UPGRADES: ReadonlyArray<[CardLevel, CardLevel]> = [[1, 2], [2, 3], [3, 4], [4, 5]];

type Theme = "light" | "dark";
type Stage = { run: number; level: CardLevel; from?: CardLevel };

function resolvedTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function CardPreviewPage() {
  const [character, setCharacter] = useState<CharacterId>("deepseek");
  const [theme, setTheme] = useState<Theme>(resolvedTheme);
  const [stage, setStage] = useState<Stage>({ run: 0, level: 2 });
  const [last, setLast] = useState("还没播过");
  const [ends, setEnds] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute("data-character", character);
  }, [character]);

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  const play = (from: CardLevel, to: CardLevel) => {
    setStage((current) => ({ run: current.run + 1, level: to, from }));
  };

  const ended = (info: UpgradeEnd) => {
    setStage((current) => ({ ...current, from: undefined }));
    setLast(`${info.from}→${info.to} ${info.skipped ? "已跳过" : "播完"}`);
    setEnds((count) => count + 1);
  };

  return (
    <main className="card-preview-page">
      <header className="card-preview__header">
        <div>
          <p className="card-preview__eyebrow">WHALEPARTNER · CHARACTER CARDS</p>
          <h1>角色闪卡</h1>
          <p className="card-preview__lead">
            五档好感度卡：素纸、银衬、潮光、金缘、鎏金箔。四位角色共用同一套卡面语言，
            升级动画逐档播放。所有点数和等级都是固定演示值，不读取真实账号。
          </p>
        </div>
        <span className="card-preview__demo">独立预览 · 演示数据</span>
      </header>

      <section className="card-preview__toolbar" aria-label="预览设置">
        <div className="card-preview__toolbar-group">
          <span className="card-preview__section-label" id="preview-character-label">角色</span>
          <div className="card-preview__chips" role="group" aria-labelledby="preview-character-label">
            {PREVIEW_CHARACTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="card-preview__chip"
                aria-label={`选择${item.name}`}
                aria-pressed={character === item.id}
                onClick={() => setCharacter(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div className="card-preview__toolbar-group">
          <span className="card-preview__section-label" id="preview-theme-label">主题</span>
          <div className="card-preview__chips" role="group" aria-labelledby="preview-theme-label">
            {(["light", "dark"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className="card-preview__chip"
                aria-pressed={theme === item}
                onClick={() => chooseTheme(item)}
              >
                {item === "light" ? "亮色" : "暗色"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card-preview__section" aria-labelledby="preview-tiers-title">
        <div className="card-preview__section-head">
          <div>
            <p className="card-preview__section-label">五档卡面</p>
            <h2 id="preview-tiers-title">从相识到相依</h2>
          </div>
          <p className="card-preview__section-note">静置时没有循环动画；Lv.2 起可以悬停或拖动倾斜，看人物、背景与边框的分层。</p>
        </div>
        <div className="card-preview__tiers" data-testid="card-tiers">
          {CARD_TIERS.map((tier) => (
            <figure className="card-preview__tier" key={tier.level}>
              <AffinityCard character={character} level={tier.level} />
              <figcaption>
                <strong>Lv.{tier.level} {tier.label}</strong>
                <span>{tier.finish} · {tier.threshold} 点起</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="card-preview__section" aria-labelledby="preview-upgrade-title">
        <div className="card-preview__section-head">
          <div>
            <p className="card-preview__section-label">升级动画</p>
            <h2 id="preview-upgrade-title">四段升级，逐档播放</h2>
          </div>
          <p className="card-preview__section-note">点一段试播；点卡面或「跳过」立即落到目标档。播完会自动停在目标档，可以反复重播。</p>
        </div>
        <div className="card-preview__upgrade">
          <div className="card-preview__stage-card" data-testid="card-stage">
            <AffinityCard
              key={`${stage.run}-${character}`}
              character={character}
              level={stage.level}
              upgradeFrom={stage.from}
              onUpgradeEnd={ended}
            />
          </div>
          <div className="card-preview__upgrade-controls">
            <p className="card-preview__section-label">选择一段升级</p>
            <div className="card-preview__upgrade-buttons" role="group" aria-label="播放升级动画">
              {UPGRADES.map(([from, to]) => (
                <button
                  key={`${from}-${to}`}
                  type="button"
                  className="card-preview__upgrade-button"
                  aria-label={`预览升级 ${from}→${to}：${tierOf(from).label}到${tierOf(to).label}`}
                  onClick={() => play(from, to)}
                >
                  <strong>{from}→{to}</strong>
                  <span>{tierOf(from).label} → {tierOf(to).label}</span>
                </button>
              ))}
            </div>
            <p className="card-preview__status" id="card-upgrade-status" data-ends={ends} aria-live="polite">
              上一次：{last} · 结束回调共 {ends} 次
            </p>
          </div>
        </div>
      </section>

      <section className="card-preview__section" aria-labelledby="preview-characters-title">
        <div className="card-preview__section-head">
          <div>
            <p className="card-preview__section-label">四位角色</p>
            <h2 id="preview-characters-title">同一套卡面，四种强调色</h2>
          </div>
          <p className="card-preview__section-note">四位角色都到 Lv.5 相依；鲸汐、大肥鱼、小克、小智各有自己的强调色和专属纹样。</p>
        </div>
        <div className="card-preview__characters" data-testid="card-characters">
          {PREVIEW_CHARACTERS.map((item) => (
            <figure className="card-preview__character" key={item.id}>
              <AffinityCard character={item.id} level={5} />
              <figcaption>
                <strong>{item.name}</strong>
                <span>Lv.5 相依 · 鎏金箔</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <footer className="card-preview__footer">
        固定演示数据，不读取真实好感度，也不会切换应用角色或写入 wp.character。升级动画只在这张预览卡上播放。
      </footer>
    </main>
  );
}
