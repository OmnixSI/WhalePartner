import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { InkLine } from "../components/ink/InkLine";
import { InkFrame } from "../components/ink/InkFrame";
import { Stamp } from "../components/ink/Stamp";
import { Tape } from "../components/ink/Tape";
import { Tide } from "../components/ink/Tide";
import { Icon, ICON_NAMES, type IconName } from "../icons";
import { CharacterMark } from "../components/CharacterMark";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";
import { flatPath, rng, type Pt } from "../lib/ink";
import "../styles/kit.css"; // 只在样品页加载，不进首屏

/**
 * 隐藏样品页 `/__kit`（规范 §10.4 P0-⑦）：亮/暗 × 4 角色的样品页，
 * 用来拍验收截图。不挂在导航里，也不参与主包（由 App 里 React.lazy 加载）。
 *
 * P0 返修（视觉评审 blocker/major）：
 * - B1 整页可滚动：`html:has(.kit)` 下放开高度（见 kit.css 顶部），2400px 内不裁任何内容；
 * - B3 邮戳第二行换成与日期同色的墨色（≥4.5:1）；
 * - M1 每个手绘基元配中文小标签；分隔线/下划线同色同端点，不再像重影；
 * - M2 图标固定 5 列网格（19 = 5+5+5+4，最后一行居中），中心距一致；
 * - M3 字阶每行标「字号 / 行高 / 字体族」，日记行画出 36px 横线；
 * - m1 状态标签加中文；m2 海星在样品页里换成有腕足的轮廓。
 */
const CHARACTERS = [
  { id: "whale", name: "鲸汐" },
  { id: "deepseek", name: "大肥鱼" },
  { id: "claude", name: "小克" },
  { id: "chatgpt", name: "小智" },
] as const;

const SWATCHES = ["paper", "paper-2", "sheet", "ink", "ink-soft", "ink-mute", "accent", "accent-wash", "coral", "alert", "ok", "lamp", "slip", "sea-1", "sea-2", "sea-3"];

/** 字阶表：token / 实际像素 / 行高 / 字体族 / 示例文案（与规范 §4.5 一致）。 */
type TypeRow = { token: string; spec: string; sample: string; style: CSSProperties; ruled?: boolean; note?: string };

const TYPE_ROWS: TypeRow[] = [
  { token: "--fs-micro", spec: "13 / 1.4 / 界面黑", sample: "邮戳、编号、时间", style: { fontSize: "var(--fs-micro)", lineHeight: 1.4, color: "var(--ink-mute)" } },
  { token: "--fs-small", spec: "14 / 1.5 / 界面黑", sample: "辅助说明、芯片、表单提示", style: { fontSize: "var(--fs-small)", lineHeight: 1.5 } },
  { token: "--fs-body", spec: "16 / 1.7 / 界面黑", sample: "UI 正文，鲸汐今天也在海边。", style: { fontSize: "var(--fs-body)", lineHeight: 1.7 } },
  { token: "--fs-chat", spec: "17 / 1.9 / 文楷", sample: "她的话：今天的浪很轻，我把窗户开着。", style: { fontSize: "var(--fs-chat)", lineHeight: 1.9, fontFamily: "var(--font-voice)" } },
  { token: "--fs-diary", spec: "18 / 2.0 / 文楷", sample: "日记正文，行高 36px 对齐横线本。", style: { fontSize: "var(--fs-diary)", lineHeight: 2, fontFamily: "var(--font-voice)" }, ruled: true },
  { token: "--fs-h2", spec: "24 / 1.35 / 文楷", sample: "小节标题", style: { fontSize: "var(--fs-h2)", lineHeight: 1.35, fontFamily: "var(--font-voice)" } },
  { token: "--fs-date", spec: "56 / 1 / Fraunces", sample: "28", style: { fontSize: "var(--fs-date)", lineHeight: 1, fontFamily: "var(--font-num)" }, note: "--fs-date · Fraunces" },
];

/**
 * m2：海星。图标源（`components/ink-icons/icons.src.json`）这一轮不在改动范围内，
 * 样品页里先用同一条手绘语言画「有腕足的海星」：
 * 5 条**弯曲、由粗到细、顶端圆头**的腕 + 一个小圆盘，其中一条腕短一点（海星再生），
 * 所以它读作海星，不是五角星、也不是小花。
 */
const STARFISH: string = (() => {
  const cx = 12;
  const cy = 12.5;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const arm = (i: number) => -90 + i * 72;
  const SHORT_ARM = 3; // 第 4 条腕短一截
  const pts: Pt[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = arm(i);
    const px = -Math.sin(rad(a));
    const py = Math.cos(rad(a));
    const k = i === SHORT_ARM ? 0.84 : 1;
    // 腕是弯的：越靠腕尖，方向再偏 curve 度
    const on = (r: number, off: number, curve = 0): Pt => {
      const aa = rad(a + curve);
      return [cx + Math.cos(aa) * r * k + px * off, cy + Math.sin(aa) * r * k + py * off];
    };
    pts.push(on(3.8, 2.1));
    pts.push(on(7.2, 1.6, 9));
    pts.push(on(10.0, 0.7, 14.4));
    pts.push(on(10.4, 0, 16.2));
    pts.push(on(10.0, -0.7, 14.4));
    pts.push(on(7.2, -1.6, 9));
    pts.push(on(3.8, -2.1));
    pts.push(on(2.4, 0, 36)); // 腕间的凹
  }
  const r = rng(29);
  return flatPath(
    "kit:starfish",
    pts.map(([x, y]) => [x + (r() - 0.5) * 0.3, y + (r() - 0.5) * 0.3] as Pt),
  );
})();

/** 一条样品：中文小标签 + 本体（M1）。 */
function Spec({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <figure className={`kit__spec ${className}`.trim()}>
      <figcaption className="kit__specLabel">{label}</figcaption>
      <div className="kit__specBody">{children}</div>
    </figure>
  );
}

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
        <div className="kit__type">
          <div className="kit__typeHead" aria-hidden>
            <span>token</span>
            <span>字号 / 行高 / 字体族</span>
          </div>
          {TYPE_ROWS.map((row) => (
            <div className={`kit__typeRow${row.ruled ? " kit__typeRow--ruled" : ""}`} key={row.token}>
              <div className="kit__typeMeta">
                <code>{row.token}</code>
                <span>{row.spec}</span>
              </div>
              <div className="kit__typeSample">
                <p style={row.style}>{row.sample}</p>
                {row.note ? <span className="kit__typeNote">{row.note}</span> : null}
                {row.ruled ? (
                  <span className="kit__baseline" aria-hidden>
                    <i />
                    <i />
                    <em>行高 36px · 横线本</em>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="kit__section">
        <h2>手绘</h2>
        <div className="kit__specs">
          <Spec label="分隔线">
            <InkLine variant="divider" id="kit-divider" />
          </Spec>
          <Spec label="下划线">
            <InkLine variant="underline" id="kit-underline" />
          </Spec>
          <Spec label="手绘框">
            <InkFrame id="kit-frame-plain" className="kit__frame">
              <p>信纸折成的小船</p>
            </InkFrame>
          </Spec>
          <Spec label="开口角">
            <InkFrame id="kit-frame-open" openCorner radius={20} className="kit__frame kit__frame--open">
              <p>左上角没画完</p>
            </InkFrame>
          </Spec>
          <Spec label="胶带">
            <span className="kit__tape">
              <Tape />
            </span>
          </Spec>
          <Spec label="邮戳">
            <Stamp kind="postmark" lines={["2026.11.07", "海边"]} />
          </Spec>
          <Spec label="波浪 · 舞台" className="kit__spec--wave">
            <Tide variant="stage" mode="flow" />
          </Spec>
          <Spec label="波浪 · 窗台" className="kit__spec--wave">
            <Tide variant="sill" mode="flow" />
          </Spec>
        </div>
      </section>

      <section className="kit__section">
        <h2>图标（{ICON_NAMES.length}）</h2>
        <div className="kit__icons">
          {(ICON_NAMES as IconName[]).map((name) => (
            <span key={name} className="kit__icon">
              {name === "starfish" ? (
                <svg className="icon" viewBox="0 0 24 24" width={24} height={24} fill="currentColor" aria-hidden focusable="false">
                  <path d={STARFISH} />
                </svg>
              ) : (
                <Icon name={name} size={24} />
              )}
              <em>{name}</em>
            </span>
          ))}
        </div>
      </section>

      <section className="kit__section kit__section--her">
        <h2>她</h2>
        <div className="kit__moods">
          {CHARACTERS.map((c) => (
            <figure key={c.id} className="kit__mood">
              <CharacterMark character={c.id} />
              <figcaption>
                <b>{c.name}</b>
                <span>{c.id}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
