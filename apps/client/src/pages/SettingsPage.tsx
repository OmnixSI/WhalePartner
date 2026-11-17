/**
 * 设置页：顶部一张「她」的概览卡，下面是一排吸顶分类标签和按分类分好的卡片组；不另做侧栏。
 *
 * 数据纪律：额度走 `lib/quota.ts`（GET /api/quota）、导出/删除走 `lib/data.ts`、
 * 昵称走 `lib/profile.ts`（GET/PUT /api/profile）。接口不在就写「现在拿不到」并禁按钮，
 * 页面自己绝不编一个数字出来。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { version as clientVersion } from "../../package.json";
import { fetchHealth } from "../lib/api";
import { describeNetError, isNetworkFailure } from "../lib/net";
import { getProfile, putNickname } from "../lib/profile";
import { getCompanionSettings, putCompanionSettings, type CompanionSettings, type CompanionSettingsPatch } from "../lib/companion";
import { readA11y } from "../lib/a11y";
import { applyTheme, readTheme, type ThemeChoice } from "../lib/theme";
import { m, locale, readLangPref, setLangPref, type LangPref } from "../i18n";
import { useCharacter } from "../characters";
import { Accounts } from "../components/Accounts";
import { reopenOnboarding } from "../components/Onboarding";
import { PageHeader } from "../components/shell/PageHeader";
import { SettingGroup, SettingRow } from "../components/settings/Row";
import { ScaleSetting } from "../components/settings/ScaleSetting";
import { Switch } from "../components/settings/Switch";
import { BackgroundRunSetting } from "../components/settings/BackgroundRunSetting";
import { ChoiceCard } from "../components/settings/ChoiceCard";
import { QuotaMeter } from "../components/settings/QuotaMeter";
import { DataSection } from "../components/settings/DataSection";
import { ModelSetup } from "../components/settings/ModelSetup";
import { CharacterDialog } from "../components/settings/CharacterDialog";
import { HerOverview } from "../components/settings/HerOverview";
import { useRelationship } from "../components/settings/useRelationship";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Field";
import { toast } from "../components/ui/toast-store";
import { SendKeySetting } from "../components/settings/SendKeySetting";
import { DevicesSetting } from "../components/settings/DevicesSetting";
import { ConnectServerSetting } from "../components/settings/ConnectServerSetting";
import { VoiceEnvironmentSetup } from "../components/settings/VoiceEnvironmentSetup";
import { updateA11y, ELDER_MIN_SCALE } from "../components/settings/prefs";
import { SurfBrowserNote } from "../components/surf/SurfBrowserNote";
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
  { id: "auto", label: m.settings.page.themeAuto, hint: m.settings.page.themeAutoHint },
  { id: "light", label: m.settings.page.themeLight, hint: m.settings.page.themeLightHint },
  { id: "dark", label: m.settings.page.themeDark, hint: m.settings.page.themeDarkHint },
];

const LANGS: Array<{ id: LangPref; label: string; hint: string }> = [
  { id: "system", label: m.app.language.system, hint: m.app.language.systemHint },
  { id: "zh", label: m.app.language.zh, hint: m.app.language.zhHint },
  { id: "en", label: m.app.language.en, hint: m.app.language.enHint },
];

const CATEGORIES = [
  { id: "her", label: m.settings.page.catHer },
  { id: "look", label: m.settings.page.catLook },
  { id: "model", label: m.settings.page.catModel },
  { id: "device", label: m.settings.page.catDevice },
  { id: "about", label: m.settings.page.catAbout },
] as const;

/** 旧的锚点（#model 等）落在哪个分类里：从首导第 3 步跳进来、或老链接都不落空。 */
const ANCHOR_CATEGORY: Record<string, string> = { model: "model", quota: "model", "voice-environment": "model", devices: "device" };

type Backend = "checking" | "ok" | "down";

export function SettingsPage() {
  const character = useCharacter();
  const [charOpen, setCharOpen] = useState(false);
  // 聊天页的升档提示带 ?card=1 过来：直接打开「换一位」里的卡面，读完就把参数清掉
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (!searchParams.has("card")) return;
    setCharOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("card");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const relationship = useRelationship(character.id, charOpen);
  const { hash } = useLocation();
  const pageRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [langPref, setLangPrefState] = useState<LangPref>(readLangPref);
  const chooseLang = (next: LangPref) => {
    setLangPrefState(next);
    setLangPref(next);
  };
  const [a11y, setA11y] = useState(readA11y);
  const [backend, setBackend] = useState<Backend>("checking");
  const [nickname, setNickname] = useState("");
  const [savingNick, setSavingNick] = useState(false);
  const [nickFailed, setNickFailed] = useState(false);
  /** 昵称没存上的原因（人话，不再是英文 Load failed） */
  const [nickError, setNickError] = useState("");
  const [activeCat, setActiveCat] = useState<string>(CATEGORIES[0].id);
  const [setupRev, setSetupRev] = useState(0);
  const [surf, setSurf] = useState<SurfSettings | null>(null);
  const [companion, setCompanion] = useState<CompanionSettings | null>(null);
  const [surfError, setSurfError] = useState("");
  /** 最近一次保存的回执：让"点了没反应"变成看得见的一句话 */
  const [surfNote, setSurfNote] = useState<{ at: string; ok: boolean; text: string } | null>(null);
  /** 存失败时记住那一次改动，好让「再试一次」直接把同一项重发，不用人重新点一遍 */
  const [surfRetry, setSurfRetry] = useState<SurfSettingsPatch | null>(null);
  const [companionError, setCompanionError] = useState("");
  const [companionNote, setCompanionNote] = useState<{ at: string; ok: boolean; text: string } | null>(null);

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
    void getCompanionSettings().then((settings) => {
      if (alive) setCompanion(settings);
    }).catch((error: unknown) => {
      if (alive) setCompanionError(describeNetError(error, m.settings.page.companionUnavailable));
    });
    return () => {
      alive = false;
    };
  }, []);

  // 逛设置按人格存：换了人格就重拉，拉到之前不让改，免得把上一位的兴趣/屏蔽词存进这一位。
  useEffect(() => {
    let alive = true;
    setSurf(null);
    setSurfError("");
    setSurfRetry(null);
    void getSurfSettings(character.id).then((settings) => {
      if (alive) setSurf(settings);
    });
    return () => {
      alive = false;
    };
  }, [character.id]);

  // 从首导第 3 步的「模型接入」入口跳进来时带 `#model`：滚到那一组，别让人自己找。
  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    document.getElementById(id)?.scrollIntoView({ block: "start" });
    setActiveCat(ANCHOR_CATEGORY[id] ?? id.replace(/^cat-/, ""));
  }, [hash]);

  // 目录高亮跟着滚动走：分类标题越过它「点目录后停靠的位置」就算到了，最后一个到了的亮；滚到底直接亮最后一组（它太短，标题上不去）。
  // 停靠位置读各分类的 scroll-margin-top（手机上是吸顶目录的高度 + 间距，随字号缩放），不写死比例，
  // 这样点目录滚到位后，亮的一定是刚点的那个。
  useEffect(() => {
    const scroller = pageRef.current;
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top;
      const atBottom = scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      let current: string = CATEGORIES[0].id;
      for (const item of CATEGORIES) {
        const node = document.getElementById(`cat-${item.id}`);
        if (!node) continue;
        const dock = top + (Number.parseFloat(getComputedStyle(node).scrollMarginTop) || 0);
        if (node.getBoundingClientRect().top <= dock + 2) current = item.id;
      }
      setActiveCat(atBottom ? CATEGORIES[CATEGORIES.length - 1].id : current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const notify = (text: string) => toast({ title: text });

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
      notify(profile.nickname ? m.settings.page.nickSaved : m.settings.page.nickCleared);
    } catch (error) {
      const why = describeNetError(error, m.settings.page.nickFailedWhy);
      setNickFailed(true);
      setNickError(why);
      if (isNetworkFailure(error)) setBackend("down");
      notify(m.settings.page.nickFailedToast);
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
    const stamp = new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    try {
      setSurf(await putSurfSettings(character.id, patch));
      setSurfNote({ at: stamp, ok: true, text: m.settings.page.saved });
      setSurfRetry(null);
    } catch (error) {
      setSurf(before); // 没存上就退回原值，不装成存好了
      const why = describeNetError(error, m.settings.page.surfSaveFailed);
      setSurfError(why);
      setSurfNote({ at: stamp, ok: false, text: m.settings.page.notSavedReverted });
      setSurfRetry(patch);
      if (isNetworkFailure(error)) setBackend("down");
    }
  };

  const saveCompanion = async (patch: CompanionSettingsPatch) => {
    if (!companion) return;
    const before = companion;
    setCompanion({ ...companion, ...patch, quiet: { ...companion.quiet, ...(patch.quiet ?? {}) } });
    setCompanionError("");
    const stamp = new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    try {
      setCompanion(await putCompanionSettings(patch));
      setCompanionNote({ at: stamp, ok: true, text: m.settings.page.saved });
    } catch (error) {
      setCompanion(before);
      setCompanionError(describeNetError(error, m.settings.page.companionSaveFailed));
      setCompanionNote({ at: stamp, ok: false, text: m.settings.page.notSavedReverted });
      if (isNetworkFailure(error)) setBackend("down");
    }
  };

  const scaleMin = a11y.elder ? ELDER_MIN_SCALE : 1;

  const goTo = (id: string) => {
    setActiveCat(id);
    // 只改地址栏不走路由：刷新后仍落在这一类，又不会再触发一次跳转。
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#cat-${id}`);
    document.getElementById(`cat-${id}`)?.scrollIntoView({ block: "start", behavior: a11y.calm ? "auto" : "smooth" });
  };

  const unavailable = (desc: string) => (
    <SettingRow title={m.settings.page.notConnected} desc={desc}>
      <span className="set-offline">{m.settings.page.unavailable}</span>
    </SettingRow>
  );

  return (
    <div className="page page--settings" ref={pageRef}>
      <div className="page__inner">
        <PageHeader title={m.settings.page.title} />

        {offline && (
          <div className="set-banner" role="status">
            <p className="set-banner__text">{m.settings.page.backendDown}</p>
            <Button variant="secondary" onClick={() => void probe()}>
              {m.settings.page.tryAgain}
            </Button>
          </div>
        )}

        <HerOverview character={character} relationship={relationship} setupRev={setupRev} onSwap={() => setCharOpen(true)} />

        <div className="set-layout">
          <nav className="set-nav" aria-label={m.settings.page.navLabel}>
            <ul className="set-nav__list">
              {CATEGORIES.map((item) => (
                <li key={item.id}>
                  <a
                    className="set-nav__item ui-press ui-focus"
                    href={`#cat-${item.id}`}
                    aria-current={activeCat === item.id ? "true" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      goTo(item.id);
                    }}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="set-main">
            <section className="set-cat" id="cat-her" aria-labelledby="cat-her-h">
              <h2 className="sr-only" id="cat-her-h">{m.settings.page.catHer}</h2>

              <SettingGroup title={m.settings.page.nickGroup}>
                <SettingRow title={m.settings.page.nickTitle} desc={m.settings.page.nickDesc} stacked>
                  <div className="set-nick">
                    <Input
                      className="set-nick__field"
                      type="text"
                      maxLength={12}
                      placeholder={m.settings.page.nickPlaceholder}
                      aria-label={m.settings.page.nickAria}
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
                    <Button className="set-nick__save" variant="secondary" disabled={offline || savingNick} onClick={() => void saveNickname()}>
                      {savingNick ? m.settings.page.nickSaving : m.settings.page.nickSave}
                    </Button>
                  </div>
                  {(offline || nickFailed) && <p className="set-row__bad">{nickError || m.settings.page.nickCantSave}</p>}
                </SettingRow>
              </SettingGroup>

              <SettingGroup
                title={m.settings.page.companionGroup}
                note={<>{m.settings.page.companionNote}{companionNote && (
                  <span className="set-receipt" data-ok={companionNote.ok ? "on" : "off"} role="status">
                    {companionNote.at} {companionNote.text}
                  </span>
                )}</>}
              >
                {companion === null ? (
                  unavailable(companionError || m.settings.page.companionNoSettings)
                ) : (
                  <>
                    <SettingRow title={m.settings.page.companionGroup} desc={m.settings.page.companionRowDesc} onActivate={() => void saveCompanion({ enabled: !companion.enabled })}>
                      <Switch label={m.settings.page.companionSwitch} checked={companion.enabled} onChange={(next) => void saveCompanion({ enabled: next })} />
                    </SettingRow>
                    <SettingRow title={m.settings.page.frequency} desc={m.settings.page.companionFreqDesc} stacked>
                      <div className="set-choices set-choices--2" role="group" aria-label={m.settings.page.companionFreqGroup}>
                        <ChoiceCard groupLabel={m.settings.page.companionFreqGroup} label={m.settings.page.freqRare} hint={m.settings.page.freqRareHint} selected={companion.frequency === "rare"} onSelect={() => void saveCompanion({ frequency: "rare" })} />
                        <ChoiceCard groupLabel={m.settings.page.companionFreqGroup} label={m.settings.page.freqNormal} hint={m.settings.page.freqNormalHint} selected={companion.frequency === "normal"} onSelect={() => void saveCompanion({ frequency: "normal" })} />
                      </div>
                    </SettingRow>
                    <SettingRow title={m.settings.page.quietTitle} desc={m.settings.page.quietDesc} stacked>
                      <div className="set-times" role="group" aria-label={m.settings.page.quietGroupAria}>
                        <label className="set-time">{m.settings.page.start} <Input type="time" aria-label={m.settings.page.quietStartAria} value={companion.quiet.start} onChange={(event) => void saveCompanion({ quiet: { start: event.target.value } })} /></label>
                        <label className="set-time">{m.settings.page.end} <Input type="time" aria-label={m.settings.page.quietEndAria} value={companion.quiet.end} onChange={(event) => void saveCompanion({ quiet: { end: event.target.value } })} /></label>
                      </div>
                    </SettingRow>
                  </>
                )}
                {companionError && companion !== null && <p className="set-row__bad" role="status">{companionError}</p>}
              </SettingGroup>

              <SettingGroup
                title={m.settings.page.surfGroup}
                note={<>{m.settings.page.surfNote}{surfNote && (
                  <span className="set-receipt" data-ok={surfNote.ok ? "on" : "off"} role="status">
                    {surfNote.at} {surfNote.text}
                  </span>
                )}</>}
              >
                {surf === null ? (
                  unavailable(m.settings.page.surfNoSettings)
                ) : (
                  <>
                    <SettingRow title={m.settings.page.surfRowTitle} desc={m.settings.page.surfRowDesc} onActivate={() => void saveSurf({ enabled: !surf.enabled })}>
                      <Switch label={m.settings.page.surfSwitch} checked={surf.enabled} onChange={(next) => void saveSurf({ enabled: next })} />
                    </SettingRow>

                    <SettingRow title={m.settings.page.frequency} desc={m.settings.page.surfFreqDesc} stacked>
                      <div className="set-choices" role="group" aria-label={m.settings.page.surfFreqGroup}>
                        {(["rare", "normal", "often"] as SurfFrequency[]).map((value) => (
                          <ChoiceCard
                            key={value}
                            groupLabel={m.settings.page.surfFreqGroup}
                            label={FREQUENCY_LABEL[value]}
                            hint={FREQUENCY_HINT[value]}
                            selected={surf.frequency === value}
                            onSelect={() => void saveSurf({ frequency: value })}
                          />
                        ))}
                      </div>
                    </SettingRow>

                    <SettingRow title={m.settings.page.surfWhatTitle} desc={m.settings.page.surfWhatDesc}>
                      <div className="set-surf-toggles">
                        <Switch label={m.settings.page.surfVideoSwitch} checked={surf.video} onChange={(next) => void saveSurf({ video: next })} />
                        <Switch label={m.settings.page.surfWebSwitch} checked={surf.web} onChange={(next) => void saveSurf({ web: next })} />
                      </div>
                    </SettingRow>
                    <p className="set-surf-legend" aria-hidden="true">
                      {m.settings.page.surfLegend}
                    </p>
                    <SurfBrowserNote character={character.id} initial={surf.browser} enabled={surf.enabled && surf.web} />

                    <SettingRow title={m.settings.page.surfShareTitle} desc={m.settings.page.surfShareDesc} onActivate={() => void saveSurf({ shareToChat: !surf.shareToChat })}>
                      <Switch label={m.settings.page.surfShareSwitch} checked={surf.shareToChat} onChange={(next) => void saveSurf({ shareToChat: next })} />
                    </SettingRow>
                  </>
                )}
              </SettingGroup>

              <SettingGroup title={m.settings.page.surfWhatGroup}>
                {surf === null ? (
                  unavailable(m.settings.page.surfNoSettings)
                ) : (
                  <>
                    <SettingRow title={m.settings.page.interests} stacked desc={m.settings.page.interestsDesc}>
                      <TagField
                        label={m.settings.page.interests}
                        placeholder={m.settings.page.interestsPlaceholder}
                        hint={m.settings.page.interestsHint}
                        values={surf.interests}
                        max={8}
                        maxChars={12}
                        onChange={(next) => void saveSurf({ interests: next })}
                      />
                    </SettingRow>

                    <SettingRow title={m.settings.page.blocked} stacked desc={m.settings.page.blockedDesc}>
                      <TagField
                        label={m.settings.page.blocked}
                        placeholder={m.settings.page.blockedPlaceholder}
                        hint={m.settings.page.blockedHint}
                        values={surf.blocked}
                        max={20}
                        maxChars={12}
                        onChange={(next) => void saveSurf({ blocked: next })}
                      />
                    </SettingRow>

                    <details className="set-fold">
                      <summary className="set-fold__summary">{m.settings.page.quietFoldSummary}</summary>
                      <div className="set-fold__body set-times">
                        <label className="set-time">
                          {m.settings.page.start}
                          <Input type="time" value={surf.quiet.start} aria-label={m.settings.page.quietFoldStartAria} onChange={(event) => void saveSurf({ quiet: { start: event.target.value } })} />
                        </label>
                        <label className="set-time">
                          {m.settings.page.end}
                          <Input type="time" value={surf.quiet.end} aria-label={m.settings.page.quietFoldEndAria} onChange={(event) => void saveSurf({ quiet: { end: event.target.value } })} />
                        </label>
                        <p className="set-surf-quiet__hint">{m.settings.page.quietFoldHint}</p>
                      </div>
                    </details>

                    <p className="set-surf-quota">
                      {m.settings.page.surfQuota}
                    </p>
                  </>
                )}
                {surfError && (
                  <div className="set-row__bad set-fail" role="alert">
                    <span>{surfError}</span>
                    {surfRetry && (
                      <Button variant="secondary" onClick={() => void saveSurf(surfRetry)}>
                        {m.settings.page.tryAgain}
                      </Button>
                    )}
                  </div>
                )}
              </SettingGroup>

              <SettingGroup title={m.settings.page.leftGroup} note={m.settings.page.leftNote}>
                <SettingRow title={m.settings.page.finds} desc={m.settings.page.findsDesc}>
                  <Link className="ui-btn ui-btn--secondary ui-press ui-focus" to="/surf">
                    {m.settings.page.goLook}
                  </Link>
                </SettingRow>
                <SettingRow title={m.settings.page.memories} desc={m.settings.page.memoriesDesc}>
                  <Link className="ui-btn ui-btn--secondary ui-press ui-focus" to="/memory">
                    {m.settings.page.goLook}
                  </Link>
                </SettingRow>
              </SettingGroup>
            </section>

            <section className="set-cat" id="cat-look" aria-labelledby="cat-look-h">
              <h2 className="sr-only" id="cat-look-h">{m.settings.page.catLook}</h2>

              <SettingGroup title={m.settings.page.lookGroup}>
                <div className="set-choices" role="group" aria-label={m.settings.page.themeGroup}>
                  {THEMES.map((item) => (
                    <ChoiceCard
                      key={item.id}
                      groupLabel={m.settings.page.themeGroup}
                      label={item.label}
                      hint={item.hint}
                      selected={theme === item.id}
                      onSelect={() => chooseTheme(item.id)}
                    />
                  ))}
                </div>
              </SettingGroup>

              <SettingGroup title={m.app.language.group} note={m.app.language.note}>
                <div className="set-choices" role="group" aria-label={m.app.language.groupLabel}>
                  {LANGS.map((item) => (
                    <ChoiceCard
                      key={item.id}
                      groupLabel={m.app.language.groupLabel}
                      label={item.label}
                      hint={item.hint}
                      selected={langPref === item.id}
                      onSelect={() => chooseLang(item.id)}
                    />
                  ))}
                </div>
              </SettingGroup>

              <SettingGroup title={m.settings.page.easeGroup}>
                <SettingRow
                  title={m.settings.page.elder}
                  desc={m.settings.page.elderDesc}
                  onActivate={() => setElder(!a11y.elder)}
                >
                  <Switch label={m.settings.page.elder} checked={a11y.elder} onChange={setElder} />
                </SettingRow>

                <ScaleSetting scale={a11y.scale} min={scaleMin} onConfirm={confirmScale} />

                <SettingRow title={m.settings.page.calm} desc={m.settings.page.calmDesc} onActivate={() => setCalm(!a11y.calm)}>
                  <Switch label={m.settings.page.calm} checked={a11y.calm} onChange={setCalm} />
                </SettingRow>
              </SettingGroup>

              <SettingGroup title={m.settings.page.chatGroup}>
                <SendKeySetting />
              </SettingGroup>
            </section>

            <section className="set-cat" id="cat-model" aria-labelledby="cat-model-h">
              <h2 className="sr-only" id="cat-model-h">{m.settings.page.catModel}</h2>

              <SettingGroup title={m.settings.page.modelGroup} id="model" note={m.settings.page.modelNote}>
                <ModelSetup offline={offline} onToast={notify} onSaved={() => setSetupRev((n) => n + 1)} />
              </SettingGroup>

              <SettingGroup title={m.settings.page.quotaGroup} id="quota">
                <QuotaMeter />
              </SettingGroup>

              <SettingGroup title={m.settings.page.voiceGroup} id="voice-environment" note={m.settings.page.voiceNote}>
                <VoiceEnvironmentSetup offline={offline} />
              </SettingGroup>
            </section>

            <section className="set-cat" id="cat-device" aria-labelledby="cat-device-h">
              <h2 className="sr-only" id="cat-device-h">{m.settings.page.catDevice}</h2>

              <SettingGroup title={m.settings.page.devicesGroup} id="devices" note={m.settings.page.devicesNote}>
                <DevicesSetting offline={offline} />
                <ConnectServerSetting onToast={notify} />
              </SettingGroup>

              <BackgroundRunSetting />

              <SettingGroup title={m.settings.page.dataGroup}>
                <DataSection offline={offline} onToast={notify} onUnavailable={() => setBackend("down")} />
              </SettingGroup>

              <details className="set-fold set-fold--card">
                <summary className="set-fold__summary">{m.settings.page.otherPlatforms}</summary>
                <div className="set-fold__body">
                  <Accounts />
                </div>
              </details>
            </section>

            <section className="set-cat" id="cat-about" aria-labelledby="cat-about-h">
              <h2 className="sr-only" id="cat-about-h">{m.settings.page.catAbout}</h2>
              <SettingGroup title={m.settings.page.aboutGroup(character.name)}>
                <p className="set-about">
                  {m.settings.page.aboutText(character.name)}
                </p>
                <p className="set-about__meta">{m.settings.page.version(clientVersion)}</p>
                <Button variant="ghost" className="set-about__again" onClick={reopenOnboarding}>
                  {m.settings.page.replayOnboarding}
                </Button>
              </SettingGroup>
            </section>
          </div>
        </div>
      </div>

      <CharacterDialog open={charOpen} onOpenChange={setCharOpen} relationship={relationship} />
    </div>
  );
}
