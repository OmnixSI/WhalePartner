import { useState } from "react";
import { AVATAR_IS_PLACEHOLDER, AVATAR_MODELS } from "../avatar/model.config";
import { Accounts } from "../components/Accounts";
import { CHARACTERS, setCharacter, setModelOverride, useCharacter, useModel } from "../characters";
import { clearHistory } from "../lib/chat";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: "auto", label: "跟随系统" },
  { id: "light", label: "晨光" },
  { id: "dark", label: "深海" },
];

export function SettingsPage() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const character = useCharacter();
  const model = useModel();
  const [cleared, setCleared] = useState<{ ok: boolean; memoriesCleared: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const choose = (value: ThemeChoice) => { setTheme(value); applyTheme(value); };
  // Tauri 的 WebView 里 window.confirm 不可靠，用应用内的二次点击确认。
  const clear = async () => {
    if (!confirming) { setConfirming(true); setCleared(null); return; }
    setConfirming(false);
    setCleared(await clearHistory());
  };

  return (
    <div className="page">
      <div className="page__inner settings-page">
        <header><h1 className="page__title">设置</h1></header>

        <section className="card settings-section">
          <h2>外观</h2>
          <div className="seg" role="group" aria-label="外观">
            {THEMES.map((item) => <button key={item.id} aria-pressed={theme === item.id} onClick={() => choose(item.id)}>{item.label}</button>)}
          </div>
        </section>

        <section className="card settings-section">
          <h2>账号</h2>
          <Accounts />
        </section>

        <section className="card settings-section">
          <h2>陪伴角色</h2>
          <div className="settings-selects">
            <label htmlFor="settings-character">角色
              <select id="settings-character" value={character.id} onChange={(event) => setCharacter(event.target.value as typeof character.id)}>
                {CHARACTERS.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.tagline}</option>)}
              </select>
            </label>
            <label htmlFor="settings-avatar">形象
              <select id="settings-avatar" value={model.id} onChange={(event) => setModelOverride(event.target.value)}>
                {AVATAR_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
          <details className="setting-info">
            <summary>形象来源与授权</summary>
            <p>{model.source}。{model.licenseNote}{AVATAR_IS_PLACEHOLDER ? " 当前形象仅作内部展示。" : ""}</p>
          </details>
        </section>

        <section className="card settings-section settings-data">
          <h2>聊天记录</h2>
          <div className="settings-clear">
            <div>
              <strong>清空聊天与聊天记忆</strong>
              <p>{confirming
                ? "将删除聊天原文和聊天产生的记忆；视频、网页及日记经历保留。"
                : cleared?.ok && cleared.memoriesCleared
                  ? "聊天记录和聊天记忆已清空。"
                  : cleared?.ok
                    ? "聊天已清空，部分记忆未能清理。"
                    : cleared
                      ? "清空失败，后端未连接。"
                      : "视频、网页和日记经历会保留。"}</p>
            </div>
            <button className="link-danger" onClick={() => void clear()}>{confirming ? "确认清空" : "清空"}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
