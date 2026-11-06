/**
 * 设置页（规范 §7.4）：大字、大行、大白话。每组 ≤5 项，右控件不用下拉列表。
 *
 * 数据纪律：额度走 `lib/quota.ts`（GET /api/quota）、导出/删除走 `lib/data.ts`、
 * 昵称走 `lib/profile.ts`（GET/PUT /api/profile）。接口不在就写「现在拿不到」并禁按钮，
 * 页面自己绝不编一个数字出来。
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { version as clientVersion } from "../../package.json";
import { fetchHealth } from "../lib/api";
import { getProfile, putNickname } from "../lib/profile";
import { readA11y } from "../lib/a11y";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";
import { useCharacter } from "../characters";
import { WhaleSticker } from "../components/WhaleSticker";
import { Accounts } from "../components/Accounts";
import { reopenOnboarding } from "../components/Onboarding";
import { SettingGroup, SettingRow } from "../components/settings/Row";
import { Switch } from "../components/settings/Switch";
import { ChoiceCard } from "../components/settings/ChoiceCard";
import { QuotaMeter } from "../components/settings/QuotaMeter";
import { DataSection } from "../components/settings/DataSection";
import { CharacterDialog } from "../components/settings/CharacterDialog";
import { Toast } from "../components/settings/Toast";
import { updateA11y, ELDER_MIN_SCALE, SCALE_MAX } from "../components/settings/prefs";
import "../styles/settings.css";

const THEMES: Array<{ id: ThemeChoice; label: string; hint: string }> = [
  { id: "auto", label: "跟随系统", hint: "电脑换色，我也跟着换" },
  { id: "light", label: "晨光", hint: "浅色的纸" },
  { id: "dark", label: "深海夜", hint: "暗一点的夜" },
];

type Backend = "checking" | "ok" | "down";

export function SettingsPage() {
  const character = useCharacter();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [a11y, setA11y] = useState(readA11y);
  const [backend, setBackend] = useState<Backend>("checking");
  const [charOpen, setCharOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [savingNick, setSavingNick] = useState(false);
  const [nickFailed, setNickFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const offline = backend === "down";

  const probe = useCallback(async () => {
    setBackend("checking");
    const health = await fetchHealth();
    setBackend(health ? "ok" : "down");
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchHealth().then((health) => {
      if (alive) setBackend(health ? "ok" : "down");
    });
    void getProfile().then((profile) => {
      if (alive && profile.nickname) setNickname(profile.nickname);
    });
    return () => {
      alive = false;
    };
  }, []);

  const chooseTheme = (next: ThemeChoice) => {
    setTheme(next);
    applyTheme(next);
  };

  const setNick = (next: boolean) => {
    setA11y(updateA11y({ elder: next }));
  };
  const setCalm = (next: boolean) => {
    setA11y(updateA11y({ calm: next }));
  };
  const setScale = (next: number) => {
    setA11y(updateA11y({ scale: next }));
  };

  const saveNickname = async () => {
    if (offline || savingNick) return;
    setSavingNick(true);
    setNickFailed(false);
    const trimmed = nickname.trim();
    try {
      const profile = await putNickname(trimmed === "" ? null : trimmed);
      setNickname(profile.nickname ?? "");
      setToast(profile.nickname ? "记下啦。" : "已经清掉了。");
    } catch {
      setNickFailed(true);
      setBackend("down");
      setToast("现在拿不到，昵称没存上。");
    } finally {
      setSavingNick(false);
    }
  };

  const scaleMin = a11y.elder ? ELDER_MIN_SCALE : 1;
  const scaleShown = Math.round(a11y.scale * 100);
  const bodyPx = Math.round(16 * a11y.scale);

  return (
    <div className="page page--settings">
      <div className="page__inner">
        <header className="set-head">
          <h1 className="page__title">设置</h1>
          <p className="set-head__lead">改完就生效，不用点保存。</p>
        </header>

        {offline && (
          <div className="set-banner" role="status">
            <p className="set-banner__text">现在拿不到后端：额度、导出、删除、昵称都要等服务起来。</p>
            <button type="button" className="btn btn--secondary" onClick={() => void probe()}>
              再试一次
            </button>
          </div>
        )}

        <SettingGroup title="她">
          <div className="set-her">
            <span className="set-her__sticker" aria-hidden="true">
              <WhaleSticker mood="idle" />
            </span>
            <div className="set-her__text">
              <p className="set-her__name">{character.name}</p>
              <p className="set-her__tagline">AI 角色 · {character.tagline}</p>
            </div>
            <button type="button" className="btn btn--secondary" onClick={() => setCharOpen(true)}>
              换一位
            </button>
          </div>

          <SettingRow
            icon="postcard"
            title="她怎么称呼你"
            desc="写在这儿，她聊天时就会这么叫你。不想说也没关系。"
            stacked
          >
            <div className="set-nick">
              <input
                className="field set-nick__field"
                type="text"
                maxLength={12}
                placeholder="不想说也没关系"
                aria-label="她怎么称呼你"
                value={nickname}
                disabled={offline}
                onChange={(event) => setNickname(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveNickname();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn--secondary set-nick__save"
                disabled={offline || savingNick}
                onClick={() => void saveNickname()}
              >
                {savingNick ? "正在记…" : "记下"}
              </button>
            </div>
            {(offline || nickFailed) && <p className="set-row__bad">现在拿不到，先记不了。</p>}
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title="让她自己逛"
          note="她可以自己去看看视频、翻翻网页。这块还没接上，先留个位置。"
        >
          <SettingRow title="自己去逛、逛的频率、逛到有意思的告诉我" desc="现在拿不到：等逛的设置接上，这里才放开关。" icon="phone">
            <span className="set-offline">还没接上</span>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="看起来">
          <div className="set-choices" role="group" aria-label="外观">
            {THEMES.map((item) => (
              <ChoiceCard
                key={item.id}
                groupLabel="外观"
                label={item.label}
                hint={item.hint}
                selected={theme === item.id}
                onSelect={() => chooseTheme(item.id)}
              />
            ))}
          </div>
        </SettingGroup>

        <SettingGroup title="方便我用">
          <SettingRow
            icon="settings"
            title="老人模式"
            desc="大字、大按钮，导航只留聊天、她的日记、设置三个入口，也不做会动的花样。"
          >
            <Switch label="老人模式" checked={a11y.elder} onChange={setNick} />
          </SettingRow>

          <SettingRow
            title="字号"
            desc={`现在 ${scaleShown}%，正文大约 ${bodyPx}px。`}
            stacked
          >
            <div className="set-scale">
              <span className="set-scale__end" aria-hidden="true">
                小Aa
              </span>
              <input
                type="range"
                className="set-slider"
                aria-label="字号"
                min={scaleMin}
                max={SCALE_MAX}
                step={0.05}
                value={a11y.scale}
                onChange={(event) => setScale(Number(event.target.value))}
              />
              <span className="set-scale__end" aria-hidden="true">
                大Aa
              </span>
            </div>
            <p className="set-scale__preview">预览：今天天气很好</p>
          </SettingRow>

          <SettingRow title="减少动画" desc="关掉会动的小细节，安静一点。">
            <Switch label="减少动画" checked={a11y.calm} onChange={setCalm} />
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="额度" id="quota">
          <QuotaMeter />
        </SettingGroup>

        <SettingGroup title="我的数据">
          <DataSection offline={offline} onToast={setToast} onUnavailable={() => setBackend("down")} />
        </SettingGroup>

        <SettingGroup title="她记得的事" note="老人模式下导航只留三项，记忆就从这里进。">
          <SettingRow icon="memory" title="她记住的关于你的事" desc="看过的、学到的、你说过的，都收在这里，可以一条条忘掉。">
            <Link className="btn btn--secondary" to="/memory">
              去看看
            </Link>
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="关于">
          <p className="set-about">
            {character.name}是一个 AI 角色，不是真人。她会陪你聊天、看视频、写日记，也会自己去逛逛。
          </p>
          <p className="set-about__meta">版本 {clientVersion}</p>
          <button type="button" className="btn btn--quiet set-about__again" onClick={reopenOnboarding}>
            重新看一遍引导
          </button>
        </SettingGroup>

        <details className="set-fold">
          <summary className="set-fold__summary">连接其他平台（B 站登录）</summary>
          <div className="set-fold__body">
            <Accounts />
          </div>
        </details>
      </div>

      <CharacterDialog open={charOpen} onOpenChange={setCharOpen} />
      <Toast text={toast} onClose={() => setToast(null)} />
    </div>
  );
}
