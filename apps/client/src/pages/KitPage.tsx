import { useEffect, useState } from "react";
import { InkLine } from "../components/ink/InkLine";
import { InkFrame } from "../components/ink/InkFrame";
import { Stamp } from "../components/ink/Stamp";
import { Tape } from "../components/ink/Tape";
import { Tide } from "../components/ink/Tide";
import { Icon, ICON_NAMES, type IconName } from "../icons";
import { WhaleSticker } from "../components/WhaleSticker";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";

/**
 * 隐藏样品页 `/__kit`（规范 §10.4 P0-⑦）：亮/暗 × 4 角色的样品页，
 * 用来拍验收截图。不挂在导航里，也不参与主包（由 App 里 React.lazy 加载）。
 */
const CHARACTERS = [
  { id: "whale", name: "鲸汐" },
  { id: "deepseek", name: "大肥鱼" },
  { id: "claude", name: "小克" },
  { id: "chatgpt", name: "小智" },
] as const;

const SWATCHES = ["paper", "paper-2", "sheet", "ink", "ink-soft", "ink-mute", "accent", "accent-wash", "coral", "alert", "ok", "lamp", "slip", "sea-1", "sea-2", "sea-3"];

export default function KitPage() {
  const [character, setCharacter] = useState<string>("whale");
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-character", character);
  }, [character]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div className="kit">
      <header className="kit__bar">
        <strong>潮汐手帐 2.0 · 样品页</strong>
        <div className="kit__group">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              className="kit__chip"
              data-active={character === c.id || undefined}
              onClick={() => setCharacter(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="kit__group">
          {(["auto", "light", "dark"] as ThemeChoice[]).map((t) => (
            <button key={t} className="kit__chip" data-active={theme === t || undefined} onClick={() => setTheme(t)}>
              {t === "auto" ? "跟随系统" : t === "light" ? "晨光" : "深海夜"}
            </button>
          ))}
        </div>
      </header>

      <section className="kit__section">
        <h2>纸与墨</h2>
        <div className="kit__swatches">
          {SWATCHES.map((name) => (
            <figure key={name} className="kit__swatch">
              <div className="kit__chipColor" style={{ background: `var(--${name})` }} />
              <figcaption>--{name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="kit__section">
        <h2>字阶</h2>
        <p style={{ fontSize: "var(--fs-micro)", color: "var(--ink-mute)" }}>--fs-micro 13 · 邮戳/编号/时间</p>
        <p style={{ fontSize: "var(--fs-small)" }}>--fs-small 14 · 辅助说明</p>
        <p style={{ fontSize: "var(--fs-body)" }}>--fs-body 16 · UI 正文，鲸汐今天也在海边。</p>
        <p style={{ fontSize: "var(--fs-chat)", fontFamily: "var(--font-voice)", lineHeight: "var(--lh-voice)" }}>
          --fs-chat 17 · 她的话：今天的浪很轻，我把窗户开着。
        </p>
        <p style={{ fontSize: "var(--fs-diary)", fontFamily: "var(--font-voice)", lineHeight: "var(--lh-diary)" }}>
          --fs-diary 18 · 日记正文，行高 36px 对齐横线本。
        </p>
        <h3 style={{ fontSize: "var(--fs-h2)", fontFamily: "var(--font-voice)" }}>--fs-h2 24 · 小节标题</h3>
        <p style={{ fontFamily: "var(--font-num)", fontSize: "var(--fs-date)", lineHeight: 1 }}>28</p>
      </section>

      <section className="kit__section">
        <h2>手绘</h2>
        <InkLine variant="divider" id="kit-divider" />
        <InkLine variant="underline" id="kit-underline" />
        <div className="kit__row">
          <InkFrame id="kit-frame-plain">
            <p>InkFrame · 手绘框</p>
          </InkFrame>
          <InkFrame id="kit-frame-open" openCorner radius={20}>
            <p>InkFrame · 开口角</p>
          </InkFrame>
        </div>
        <div className="kit__row">
          <Tape />
          <Stamp kind="postmark" lines={["2026.11.07", "海边"]} />
          <Stamp kind="label" lines={["鲸汐"]} />
        </div>
        <Tide variant="stage" />
        <Tide variant="sill" />
      </section>

      <section className="kit__section">
        <h2>图标（{ICON_NAMES.length}）</h2>
        <div className="kit__row kit__icons">
          {(ICON_NAMES as IconName[]).map((name) => (
            <span key={name} className="kit__icon">
              <Icon name={name} size={24} />
              <em>{name}</em>
            </span>
          ))}
        </div>
      </section>

      <section className="kit__section">
        <h2>她</h2>
        <div className="kit__row kit__moods">
          {["calm", "happy", "sad", "sleepy", "curious", "thinking", "surprised", "shy", "proud", "worried"].map((mood) => (
            <figure key={mood} className="kit__mood">
              <WhaleSticker mood={mood as never} />
              <figcaption>{mood}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
