/**
 * 设置页（规范 §7.4）：大字、大行、大白话。每组 ≤5 项，右控件不用下拉列表。
 *
 * 数据纪律：额度走 `lib/quota.ts`（GET /api/quota）、导出/删除走 `lib/data.ts`、
 * 昵称走 `lib/profile.ts`（GET/PUT /api/profile）。接口不在就写「现在拿不到」并禁按钮，
 * 页面自己绝不编一个数字出来。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { version as clientVersion } from "../../package.json";
import { fetchHealth } from "../lib/api";
import { describeNetError, isNetworkFailure } from "../lib/net";
import { getProfile, putNickname } from "../lib/profile";
import { readA11y } from "../lib/a11y";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";
import { useCharacter } from "../characters";
import { WhaleSticker } from "../components/WhaleSticker";
import { Accounts } from "../components/Accounts";
import { reopenOnboarding } from "../components/Onboarding";
import { SettingGroup, SettingRow } from "../components/settings/Row";
import { ScaleSetting } from "../components/settings/ScaleSetting";
import { Switch } from "../components/settings/Switch";
import { ChoiceCard } from "../components/settings/ChoiceCard";
import { QuotaMeter } from "../components/settings/QuotaMeter";
import { DataSection } from "../components/settings/DataSection";
import { ModelSetup } from "../components/settings/ModelSetup";
import { CharacterDialog } from "../components/settings/CharacterDialog";
import { Toast } from "../components/settings/Toast";
import { updateA11y, ELDER_MIN_SCALE } from "../components/settings/prefs";
import { TagField } from "../components/surf/TagField";
import {
  FREQUENCY_HINT,
  FREQUENCY_LABEL,
  getSurfSettings,
  putSurfSettings,
  type SurfFrequency,
  type SurfSettings,
  type SurfSettingsPatch,
} from "../lib/surf";
import "../styles/settings.css";

const THEMES: Array<{ id: ThemeChoice; label: string; hint: string }> = [
  { id: "auto", label: "跟随系统", hint: "电脑换色，我也跟着换" },
  { id: "light", label: "晨光", hint: "浅色的纸" },
  { id: "dark", label: "深海夜", hint: "暗一点的夜" },
];

type Backend = "checking" | "ok" | "down";

export function SettingsPage() {
  const character = useCharacter();
  const { hash } = useLocation();
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [a11y, setA11y] = useState(readA11y);
  const [backend, setBackend] = useState<Backend>("checking");
  const [charOpen, setCharOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [savingNick, setSavingNick] = useState(false);
  const [nickFailed, setNickFailed] = useState(false);
  /** 昵称没存上的原因（人话，不再是英文 Load failed） */
  const [nickError, setNickError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [surf, setSurf] = useState<SurfSettings | null>(null);
  const [surfError, setSurfError] = useState("");
  /** 最近一次保存的回执：让"点了没反应"变成看得见的一句话 */
  const [surfNote, setSurfNote] = useState<{ at: string; ok: boolean; text: string } | null>(null);
  /** 存失败时记住那一次改动，好让「再试一次」直接把同一项重发，不用人重新点一遍 */
  const [surfRetry, setSurfRetry] = useState<SurfSettingsPatch | null>(null);

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
    void getSurfSettings(character.id).then((settings) => {
      if (alive) setSurf(settings);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 从首导第 3 步的「模型接入」入口跳进来时带 `#model`：滚到那一组，别让人自己找。
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  const chooseTheme = (next: ThemeChoice) => {
    setTheme(next);
    applyTheme(next);
  };

  const setElder = (next: boolean) => {
    setA11y(updateA11y({ elder: next }));
  };
  const setCalm = (next: boolean) => {
    setA11y(updateA11y({ calm: next }));
  };
  const confirmScale = (next: number) => setA11y(updateA11y({ scale: next }));

  const saveNickname = async () => {
    if (offline || savingNick) return;
    setSavingNick(true);
    setNickFailed(false);
    const trimmed = nickname.trim();
    try {
      const profile = await putNickname(trimmed === "" ? null : trimmed);
      setNickname(profile.nickname ?? "");
      setNickFailed(false);
      setNickError("");
      setToast(profile.nickname ? "记下啦。" : "已经清掉了。");
    } catch (error) {
      const why = describeNetError(error, "昵称没存上");
      setNickFailed(true);
      setNickError(why);
      if (isNetworkFailure(error)) setBackend("down");
      setToast("昵称没存上。");
    } finally {
      setSavingNick(false);
    }
  };

  /** 「她自己去逛」的两组设置：改一项存一项，失败就退回原值并说明。 */
  const saveSurf = async (patch: SurfSettingsPatch) => {
    if (!surf) return;
    const before = surf;
    setSurf({ ...surf, ...patch, quiet: { ...surf.quiet, ...(patch.quiet ?? {}) } });
    setSurfError("");
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    try {
      setSurf(await putSurfSettings(character.id, patch));
      setSurfNote({ at: stamp, ok: true, text: "已保存" });
      setSurfRetry(null);
    } catch (error) {
      setSurf(before); // 没存上就退回原值，不装成存好了
      const why = describeNetError(error, "逛设置没存上");
      setSurfError(why);
      setSurfNote({ at: stamp, ok: false, text: "没存上，已退回原来的样子" });
      setSurfRetry(patch);
      if (isNetworkFailure(error)) setBackend("down");
    }
  };

  const scaleMin = a11y.elder ? ELDER_MIN_SCALE : 1;

  return (
    <div className="page page--settings">
      <div className="page__inner">
        <header className="set-head">
          <h1 className="page__title">设置</h1>
        <p className="set-head__lead">大多数设置改完就生效；字号调整后点“确认”应用。</p>
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
            {(offline || nickFailed) && <p className="set-row__bad">{nickError || "现在拿不到，先记不了。"}</p>}
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title="让她自己逛"
          note={<>她可以自己去看看视频、翻翻网页，回来讲给你听。{surfNote && (
            <span className="set-receipt" data-ok={surfNote.ok ? "on" : "off"} role="status">
              {surfNote.at} {surfNote.text}
            </span>
          )}</>}
        >
          {surf === null ? (
            <SettingRow title="自己去逛" desc="现在拿不到她的逛设置。" icon="phone">
              <span className="set-offline">还没接上</span>
            </SettingRow>
          ) : (
            <>
              <SettingRow icon="phone" title="自己去逛" desc="开了之后，她会自己去看视频、翻网页，回来讲给你听。" onActivate={() => void saveSurf({ enabled: !surf.enabled })}>
                <Switch label="让她自己逛" checked={surf.enabled} onChange={(next) => void saveSurf({ enabled: next })} />
              </SettingRow>

              <SettingRow title="频率" desc="每次最多看 1–2 个视频、翻 3 个网页。" stacked>
                <div className="set-choices" role="group" aria-label="逛的频率">
                  {(["rare", "normal", "often"] as SurfFrequency[]).map((value) => (
                    <ChoiceCard
                      key={value}
                      groupLabel="逛的频率"
                      label={FREQUENCY_LABEL[value]}
                      hint={FREQUENCY_HINT[value]}
                      selected={surf.frequency === value}
                      onSelect={() => void saveSurf({ frequency: value })}
                    />
                  ))}
                </div>
              </SettingRow>

              <SettingRow title="看什么" desc="两样都可以关掉；都关掉她就不出门了。">
                <div className="set-surf-toggles">
                  <Switch label="看视频（B 站）" checked={surf.video} onChange={(next) => void saveSurf({ video: next })} />
                  <Switch label="翻网页" checked={surf.web} onChange={(next) => void saveSurf({ web: next })} />
                </div>
              </SettingRow>
              <p className="set-surf-legend" aria-hidden="true">
                左边是看视频（B 站），右边是翻网页。
              </p>

              <SettingRow title="讲给我听" desc="逛到有意思的，她会在聊天里告诉我。" onActivate={() => void saveSurf({ shareToChat: !surf.shareToChat })}>
                <Switch label="讲给我听" checked={surf.shareToChat} onChange={(next) => void saveSurf({ shareToChat: next })} />
              </SettingRow>
            </>
          )}
        </SettingGroup>

        <SettingGroup title="她逛什么">
          {surf === null ? (
            <SettingRow title="兴趣和屏蔽词" desc="现在拿不到她的逛设置。" icon="newspaper">
              <span className="set-offline">还没接上</span>
            </SettingRow>
          ) : (
            <>
              <SettingRow title="兴趣" stacked desc="她自己也有喜欢的，这里是帮她多想几个。">
                <TagField
                  label="兴趣"
                  placeholder="加一个她可能喜欢的，比如：鲸歌"
                  hint="最多 8 个，每个不超过 12 个字。"
                  values={surf.interests}
                  max={8}
                  maxChars={12}
                  onChange={(next) => void saveSurf({ interests: next })}
                />
              </SettingRow>

              <SettingRow title="不想看的" stacked desc="带这些词的内容，她会直接跳过。">
                <TagField
                  label="不想看的"
                  placeholder="加一个不想让她看的词"
                  hint="最多 20 个，每个不超过 12 个字。"
                  values={surf.blocked}
                  max={20}
                  maxChars={12}
                  onChange={(next) => void saveSurf({ blocked: next })}
                />
              </SettingRow>

              <details className="set-fold set-fold--inline">
                <summary className="set-fold__summary">更多：安静时段</summary>
                <div className="set-fold__body set-surf-quiet">
                  <label className="set-surf-time">
                    <span>开始</span>
                    <input
                      className="field"
                      type="time"
                      value={surf.quiet.start}
                      aria-label="安静时段开始"
                      onChange={(event) => void saveSurf({ quiet: { start: event.target.value } })}
                    />
                  </label>
                  <label className="set-surf-time">
                    <span>结束</span>
                    <input
                      className="field"
                      type="time"
                      value={surf.quiet.end}
                      aria-label="安静时段结束"
                      onChange={(event) => void saveSurf({ quiet: { end: event.target.value } })}
                    />
                  </label>
                  <p className="set-surf-quiet__hint">这段时间她不出门，也不主动发消息。</p>
                </div>
              </details>

              <p className="set-surf-quota">
                她自己去逛也会用贝壳：看一个视频 20 个，翻一个网页 3 个。贝壳少于一成时她会先歇着。
              </p>
            </>
          )}
          {surfError && (
            <div className="set-row__bad set-fail" role="alert">
              <span>{surfError}</span>
              {surfRetry && (
                <button type="button" className="btn btn--secondary" onClick={() => void saveSurf(surfRetry)}>
                  再试一次
                </button>
              )}
            </div>
          )}
        </SettingGroup>

        <SettingGroup title="她的见闻" note="她自己逛回来的东西都收在这里。">
          <SettingRow icon="postcard" title="看看她逛到了什么" desc="剪报墙：按天排，可以搜，也可以一条条忘掉。">
            <Link className="btn btn--secondary" to="/surf">
              去看看
            </Link>
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
            onActivate={() => setElder(!a11y.elder)}
          >
            <Switch label="老人模式" checked={a11y.elder} onChange={setElder} />
          </SettingRow>

          <ScaleSetting scale={a11y.scale} min={scaleMin} onConfirm={confirmScale} />

          <SettingRow title="减少动画" desc="关掉会动的小细节，安静一点。" onActivate={() => setCalm(!a11y.calm)}>
            <Switch label="减少动画" checked={a11y.calm} onChange={setCalm} />
          </SettingRow>
        </SettingGroup>

        <SettingGroup title="模型接入" id="model" note="接哪家模型、用多大强度，都在这儿改；以前只能翻 .env 和本机配置。">
          <ModelSetup offline={offline} onToast={setToast} />
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
