import { useState } from "react";
import { AVATAR_MODEL } from "../avatar/model.config";
import { clearHistory } from "../lib/chat";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: "auto", label: "跟随系统" },
  { id: "light", label: "晨光" },
  { id: "dark", label: "深海" },
];

export function SettingsPage() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [cleared, setCleared] = useState<boolean | null>(null);
  const choose = (t: ThemeChoice) => { setTheme(t); applyTheme(t); };
  const [confirming, setConfirming] = useState(false);
  // Tauri 的 WebView 里 window.confirm 不可靠，用应用内的二次点击确认。
  const clear = async () => {
    if (!confirming) { setConfirming(true); setCleared(null); return; }
    setConfirming(false);
    setCleared(await clearHistory());
  };

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
              <div className="row__label">角色形象</div>
              <div className="row__desc">
                {AVATAR_MODEL.label}，{AVATAR_MODEL.author}，
                <a href={AVATAR_MODEL.licenseUrl} target="_blank" rel="noreferrer">{AVATAR_MODEL.license}</a>。
                {AVATAR_MODEL.placeholder && "这是演示形象，不是鲸汐的正式设定。"}
              </div>
            </div>
          </div>
          <div className="row">
            <div>
              <div className="row__label">聊天记录</div>
              <div className="row__desc">{confirming ? "再点一次确认。清空后不能撤销，鲸汐不会再看到之前的对话。" : cleared === true ? "已清空。" : cleared === false ? "清空失败，后端未连接。" : "清空后，鲸汐不会再看到之前的对话内容。"}</div>
            </div>
            <button className="seg" onClick={() => void clear()}><span style={{ padding: "7px 16px", color: "var(--coral)", fontWeight: 600 }}>{confirming ? "确认清空" : "清空"}</span></button>
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
