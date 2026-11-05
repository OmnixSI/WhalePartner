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
          <Accounts />
          <div className="row row--stack">
            <div>
              <div className="row__label">角色</div>
              <div className="row__desc">每个角色有自己的口吻和聊天记录，你的记忆是共用的。{character.fan && `${character.name}是网友给 ${character.tagline.replace(" 娘", "").replace("鲸鱼娘", "")} 画的同人形象，不是官方。`}</div>
            </div>
            <div className="chips" role="group" aria-label="角色">
              {CHARACTERS.map((c) => (
                <button key={c.id} className="chip" aria-pressed={character.id === c.id} onClick={() => setCharacter(c.id)}>{c.name}<small>{c.tagline}</small></button>
              ))}
            </div>
          </div>
          <div className="row row--stack">
            <div>
              <div className="row__label">形象</div>
              <div className="row__desc">
                {model.source}。{model.licenseNote}。{AVATAR_IS_PLACEHOLDER && "现成的演示形象，没有核对过对外发布的授权，只作内部展示。"}
              </div>
            </div>
            <div className="chips" role="group" aria-label="形象">
              {AVATAR_MODELS.map((m) => (
                <button key={m.id} className="chip chip--plain" aria-pressed={model.id === m.id} onClick={() => setModelOverride(m.id)}>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <div>
              <div className="row__label">聊天记录</div>
              <div className="row__desc">{confirming ? "再点一次确认。聊天原文、对话事实、会话摘要和聊天中学到的内容会一并清除；视频、网页和日记经历保留。" : cleared?.ok && cleared.memoriesCleared ? "聊天原文与聊天产生的记忆已清空；视频、网页和日记经历保留。" : cleared?.ok ? "聊天原文已清空，但部分长期记忆未能清理；请检查记忆页。" : cleared ? "清空失败，后端未连接。" : "可清除聊天原文及聊天产生的事实、摘要和学习内容；视频、网页和日记经历会保留。"}</div>
            </div>
            <button className="link-danger" onClick={() => void clear()}>{confirming ? "确认清空" : "清空"}</button>
          </div>
          <div className="row">
            <div>
              <div className="row__label">关于</div>
              <div className="row__desc">WhalePartner 第一周原型 · 这里的角色都是 AI，不是真人。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
