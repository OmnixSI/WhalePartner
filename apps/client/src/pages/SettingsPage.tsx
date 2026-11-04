import { useState } from "react";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: "auto", label: "跟随系统" },
  { id: "light", label: "晨光" },
  { id: "dark", label: "深海" },
];

export function SettingsPage() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const choose = (t: ThemeChoice) => { setTheme(t); applyTheme(t); };

  return (
    <div className="page">
      <div className="page__inner">
        <header>
          <p className="page__eyebrow">Settings</p>
          <h1 className="page__title">设置</h1>
        </header>
        <div className="card">
          <div className="row">
            <div>
              <div className="row__label">外观</div>
              <div className="row__desc">晨光是浅色，深海是深色。</div>
            </div>
            <div className="seg" role="group" aria-label="外观">
              {THEMES.map((t) => (
                <button key={t.id} aria-pressed={theme === t.id} onClick={() => choose(t.id)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <div>
              <div className="row__label">关于</div>
              <div className="row__desc">WhalePartner 第一周原型 · 鲸汐是原创 AI 角色，不是真人。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
