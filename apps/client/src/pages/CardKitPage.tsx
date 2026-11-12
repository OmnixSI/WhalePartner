import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Switch } from "../components/ui";
import type { CharacterId } from "../characters";
import { AffinityCard, type UpgradeEnd } from "../card-preview/tier/AffinityCard";
import { CARD_TIERS, type CardLevel } from "../card-preview/tier/tiers";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";
import { applyA11y, readA11y } from "../lib/a11y";
import "./UiKitPage.css";
import "./CardKitPage.css";

/**
 * 隐藏预览页 `/__kit/cards`（#159）：好感度卡五档并排、四段升级动画、缩略卡、四位角色的 Lv4 / Lv5。
 * 分数只是演示用的门槛，不读真实好感度（#160 接）。由 UiKitPage 按路径懒加载（App 的 `/__kit/*`），卡面代码不进首屏。
 */
const CHARACTERS: ReadonlyArray<{ id: CharacterId; name: string }> = [
  { id: "whale", name: "鲸汐" },
  { id: "deepseek", name: "大肥鱼" },
  { id: "claude", name: "小克" },
  { id: "chatgpt", name: "小智" },
];

const UPGRADES: ReadonlyArray<[CardLevel, CardLevel]> = [[1, 2], [2, 3], [3, 4], [4, 5], [1, 5]];

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="uikit__section" aria-labelledby={`cardkit-${id}`}>
      <h2 id={`cardkit-${id}`}>{title}</h2>
      {note ? <p className="uikit__note">{note}</p> : null}
      {children}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <Button variant={active ? "primary" : "ghost"} aria-pressed={active} onClick={onClick}>{children}</Button>;
}

export default function CardKitPage() {
  const [character, setCharacter] = useState<CharacterId>("whale");
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [calm, setCalm] = useState(() => readA11y().calm);
  const [stage, setStage] = useState<{ level: CardLevel; from?: CardLevel }>({ level: 2 });
  const [last, setLast] = useState("还没播过");

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const prev = readA11y();
    applyA11y({ ...prev, calm });
    return () => applyA11y(prev);
  }, [calm]);

  const play = (from: CardLevel, to: CardLevel) => setStage({ level: to, from });
  const ended = (info: UpgradeEnd) => {
    setStage((s) => ({ level: s.level }));
    setLast(`${info.from}→${info.to} ${info.skipped ? "已跳过" : "播完"}`);
  };

  return (
    <div className="uikit cardkit">
      <header className="uikit__bar" aria-label="预览设置">
        <h1>好感度卡 · 五档预览</h1>
        <div className="uikit__group" role="group" aria-label="角色">
          {CHARACTERS.map((c) => <Chip key={c.id} active={character === c.id} onClick={() => setCharacter(c.id)}>{c.name}</Chip>)}
        </div>
        <div className="uikit__group" role="group" aria-label="主题">
          {(["light", "dark"] as const).map((t) => <Chip key={t} active={theme === t} onClick={() => setTheme(t)}>{t === "light" ? "白天" : "夜里"}</Chip>)}
        </div>
        <Switch label="安静模式" checked={calm} onCheckedChange={setCalm} />
        <span className="uikit__label" aria-hidden="true">安静模式</span>
      </header>
      <p className="uikit__note">分数是后端的阶段门槛，仅演示，不读真实好感度。组件预览在 <Link to="/__kit">/__kit</Link>。</p>

      <Section id="tiers" title="五档并排" note="Lv2 起卡片常态微微立起，不用悬停也看得出层次；精确指针下可以倾斜，悬停时扫一道光。静置时卡面没有任何循环动画。">
        <div className="cardkit__row" data-testid="card-tiers">
          {CARD_TIERS.map((t) => (
            <figure className="cardkit__fig" key={t.level}>
              <AffinityCard character={character} level={t.level} />
              <figcaption><strong>Lv.{t.level} {t.label}</strong><span>{t.finish} · {t.threshold} 分起</span></figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section id="upgrade" title="升级动画" note="每一步都有自己的动画，点卡面或「跳过」立即落到新卡面。连升时逐档快进，整段不超过 3 秒。安静模式下只淡入新卡面，并显示「升到 Lv.N」。">
        <div className="cardkit__stage">
          <AffinityCard character={character} level={stage.level} upgradeFrom={stage.from} onUpgradeEnd={ended} />
          <div className="cardkit__controls">
            <div className="uikit__group" role="group" aria-label="播放升级动画">
              {UPGRADES.map(([from, to]) => (
                <Button key={`${from}-${to}`} variant="secondary" onClick={() => play(from, to)}>
                  {to - from > 1 ? `连升 ${from}→${to}` : `${from}→${to}`}
                </Button>
              ))}
            </div>
            <p className="uikit__note" id="cardkit-last">上一次：{last}</p>
          </div>
        </div>
      </Section>

      <Section id="thumbs" title="缩略卡" note="同一套卡面的静态缩小版：不倾斜、不响应悬停、不挂 Live2D。">
        <div className="cardkit__row cardkit__row--sm">
          {CARD_TIERS.map((t) => <AffinityCard key={t.level} character={character} level={t.level} size="sm" />)}
        </div>
      </Section>

      <Section id="signature" title="四位角色 · Lv4 与 Lv5" note="Lv4 起每位角色一套专属纹样：鲸汐是鲸尾掀起的水纹和气泡，大肥鱼是水柱和水珠，小克是翻飞的书页和茶气，小智是抽枝的藤叶。">
        <div className="cardkit__row" data-testid="card-signatures">
          {CHARACTERS.flatMap((c) => ([4, 5] as const).map((level) => (
            <figure className="cardkit__fig" key={`${c.id}-${level}`}>
              <AffinityCard character={c.id} level={level} />
              <figcaption><strong>{c.name} · Lv.{level}</strong></figcaption>
            </figure>
          )))}
        </div>
      </Section>
    </div>
  );
}
