/**
 * 设置页：顶部一张「她」的概览卡，下面左边是分类目录、右边是按分类分好的卡片组；窄屏目录收成一排横向标签。
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
import { useCharacter } from "../characters";
import { Accounts } from "../components/Accounts";
import { reopenOnboarding } from "../components/Onboarding";
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
import { Toaster, toast } from "../components/ui/Toast";
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
  { id: "auto", label: "跟随系统", hint: "电脑换色，我也跟着换" },
  { id: "light", label: "晨光", hint: "浅色的纸" },
  { id: "dark", label: "深海夜", hint: "暗一点的夜" },
];

const CATEGORIES = [
  { id: "her", label: "她与陪伴" },
  { id: "look", label: "外观与使用" },
  { id: "model", label: "模型与额度" },
  { id: "device", label: "设备与数据" },
  { id: "about", label: "关于" },
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
      if (alive) setCompanionError(describeNetError(error, "主动陪伴设置现在拿不到"));
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
      notify(profile.nickname ? "记下啦。" : "已经清掉了。");
    } catch (error) {
      const why = describeNetError(error, "昵称没存上");
      setNickFailed(true);
      setNickError(why);
      if (isNetworkFailure(error)) setBackend("down");
      notify("昵称没存上。");
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

  const saveCompanion = async (patch: CompanionSettingsPatch) => {
    if (!companion) return;
    const before = companion;
    setCompanion({ ...companion, ...patch, quiet: { ...companion.quiet, ...(patch.quiet ?? {}) } });
    setCompanionError("");
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    try {
      setCompanion(await putCompanionSettings(patch));
      setCompanionNote({ at: stamp, ok: true, text: "已保存" });
    } catch (error) {
      setCompanion(before);
      setCompanionError(describeNetError(error, "主动陪伴设置没存上"));
      setCompanionNote({ at: stamp, ok: false, text: "没存上，已退回原来的样子" });
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
    <SettingRow title="还没接上" desc={desc}>
      <span className="set-offline">暂时看不到</span>
    </SettingRow>
  );

  return (
    <div className="page page--settings" ref={pageRef}>
      <div className="page__inner">
        <header className="set-head">
          <h1 className="page__title">设置</h1>
          <p className="set-head__lead">大多数设置改完就生效；字号调整后点“确认”应用。</p>
        </header>

        {offline && (
          <div className="set-banner" role="status">
            <p className="set-banner__text">现在拿不到后端：额度、导出、删除、昵称都要等服务起来。</p>
            <Button variant="secondary" onClick={() => void probe()}>
              再试一次
            </Button>
          </div>
        )}

        <HerOverview character={character} relationship={relationship} setupRev={setupRev} onSwap={() => setCharOpen(true)} />

        <div className="set-layout">
          <nav className="set-nav" aria-label="设置分类">
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
              <h2 className="set-cat__title" id="cat-her-h">她与陪伴</h2>

              <SettingGroup title="她怎么称呼你">
                <SettingRow title="昵称" desc="写在这儿，她聊天时就会这么叫你。不想说也没关系。" stacked>
                  <div className="set-nick">
                    <Input
                      className="set-nick__field"
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
                    <Button className="set-nick__save" variant="secondary" disabled={offline || savingNick} onClick={() => void saveNickname()}>
                      {savingNick ? "正在记…" : "记下"}
                    </Button>
                  </div>
                  {(offline || nickFailed) && <p className="set-row__bad">{nickError || "现在拿不到，先记不了。"}</p>}
                </SettingRow>
              </SettingGroup>

              <SettingGroup
                title="主动找你"
                note={<>只会从你明确提过的计划里挑一件，安静时再问问近况；后端停止或电脑休眠时不会运行。{companionNote && (
                  <span className="set-receipt" data-ok={companionNote.ok ? "on" : "off"} role="status">
                    {companionNote.at} {companionNote.text}
                  </span>
                )}</>}
              >
                {companion === null ? (
                  unavailable(companionError || "现在拿不到主动陪伴设置。")
                ) : (
                  <>
                    <SettingRow title="主动找你" desc="开启后，肥鱼会在你提过计划、而且一段时间没聊天时，主动问一句。" onActivate={() => void saveCompanion({ enabled: !companion.enabled })}>
                      <Switch label="让肥鱼主动找你" checked={companion.enabled} onChange={(next) => void saveCompanion({ enabled: next })} />
                    </SettingRow>
                    <SettingRow title="频率" desc="少一点：一天最多 1 条，间隔 18 小时；偶尔：一天最多 2 条，间隔 6 小时。" stacked>
                      <div className="set-choices set-choices--2" role="group" aria-label="主动陪伴频率">
                        <ChoiceCard groupLabel="主动陪伴频率" label="少一点" hint="一天最多一条" selected={companion.frequency === "rare"} onSelect={() => void saveCompanion({ frequency: "rare" })} />
                        <ChoiceCard groupLabel="主动陪伴频率" label="偶尔" hint="一天最多两条" selected={companion.frequency === "normal"} onSelect={() => void saveCompanion({ frequency: "normal" })} />
                      </div>
                    </SettingRow>
                    <SettingRow title="免打扰" desc="这段时间不会发出主动消息。默认晚上 11 点到早上 8 点。" stacked>
                      <div className="set-times" role="group" aria-label="主动陪伴免打扰时段">
                        <label className="set-time">开始 <Input type="time" aria-label="免打扰开始时间" value={companion.quiet.start} onChange={(event) => void saveCompanion({ quiet: { start: event.target.value } })} /></label>
                        <label className="set-time">结束 <Input type="time" aria-label="免打扰结束时间" value={companion.quiet.end} onChange={(event) => void saveCompanion({ quiet: { end: event.target.value } })} /></label>
                      </div>
                    </SettingRow>
                  </>
                )}
                {companionError && companion !== null && <p className="set-row__bad" role="status">{companionError}</p>}
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
                  unavailable("现在拿不到她的逛设置。")
                ) : (
                  <>
                    <SettingRow title="自己去逛" desc="开了之后，她会自己去看视频、翻网页，回来讲给你听。" onActivate={() => void saveSurf({ enabled: !surf.enabled })}>
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
                    <SurfBrowserNote character={character.id} initial={surf.browser} enabled={surf.enabled && surf.web} />

                    <SettingRow title="讲给我听" desc="逛到有意思的，她会在聊天里告诉我。" onActivate={() => void saveSurf({ shareToChat: !surf.shareToChat })}>
                      <Switch label="讲给我听" checked={surf.shareToChat} onChange={(next) => void saveSurf({ shareToChat: next })} />
                    </SettingRow>
                  </>
                )}
              </SettingGroup>

              <SettingGroup title="她逛什么">
                {surf === null ? (
                  unavailable("现在拿不到她的逛设置。")
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

                    <details className="set-fold">
                      <summary className="set-fold__summary">更多：安静时段</summary>
                      <div className="set-fold__body set-times">
                        <label className="set-time">
                          开始
                          <Input type="time" value={surf.quiet.start} aria-label="安静时段开始" onChange={(event) => void saveSurf({ quiet: { start: event.target.value } })} />
                        </label>
                        <label className="set-time">
                          结束
                          <Input type="time" value={surf.quiet.end} aria-label="安静时段结束" onChange={(event) => void saveSurf({ quiet: { end: event.target.value } })} />
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
                      <Button variant="secondary" onClick={() => void saveSurf(surfRetry)}>
                        再试一次
                      </Button>
                    )}
                  </div>
                )}
              </SettingGroup>

              <SettingGroup title="她留下的东西" note="老人模式下导航只留三项，记忆就从这里进。">
                <SettingRow title="她的见闻" desc="她自己逛回来的东西：按天排，可以搜，也可以一条条忘掉。">
                  <Link className="ui-btn ui-btn--secondary ui-press ui-focus" to="/surf">
                    去看看
                  </Link>
                </SettingRow>
                <SettingRow title="她记住的关于你的事" desc="看过的、学到的、你说过的，都收在这里，可以一条条忘掉。">
                  <Link className="ui-btn ui-btn--secondary ui-press ui-focus" to="/memory">
                    去看看
                  </Link>
                </SettingRow>
              </SettingGroup>
            </section>

            <section className="set-cat" id="cat-look" aria-labelledby="cat-look-h">
              <h2 className="set-cat__title" id="cat-look-h">外观与使用</h2>

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

              <SettingGroup title="聊天">
                <SendKeySetting />
              </SettingGroup>
            </section>

            <section className="set-cat" id="cat-model" aria-labelledby="cat-model-h">
              <h2 className="set-cat__title" id="cat-model-h">模型与额度</h2>

              <SettingGroup title="模型接入" id="model" note="接哪家模型、用多大强度，都在这儿改；以前只能翻 .env 和本机配置。">
                <ModelSetup offline={offline} onToast={notify} onSaved={() => setSetupRev((n) => n + 1)} />
              </SettingGroup>

              <SettingGroup title="额度" id="quota">
                <QuotaMeter />
              </SettingGroup>

              <SettingGroup title="语音环境" id="voice-environment" note="一键配置或重建语音转写与语音回答所需的模型和运行时。">
                <VoiceEnvironmentSetup offline={offline} />
              </SettingGroup>
            </section>

            <section className="set-cat" id="cat-device" aria-labelledby="cat-device-h">
              <h2 className="set-cat__title" id="cat-device-h">设备与数据</h2>

              <SettingGroup title="我的设备" id="devices" note="数据只放在一台「家」里，其他设备都连过来，所以到哪都是同步的。">
                <DevicesSetting offline={offline} />
                <ConnectServerSetting onToast={notify} />
              </SettingGroup>

              <BackgroundRunSetting />

              <SettingGroup title="我的数据">
                <DataSection offline={offline} onToast={notify} onUnavailable={() => setBackend("down")} />
              </SettingGroup>

              <details className="set-fold set-fold--card">
                <summary className="set-fold__summary">连接其他平台（B 站登录）</summary>
                <div className="set-fold__body">
                  <Accounts />
                </div>
              </details>
            </section>

            <section className="set-cat" id="cat-about" aria-labelledby="cat-about-h">
              <h2 className="set-cat__title" id="cat-about-h">关于</h2>
              <SettingGroup title={`关于${character.name}`}>
                <p className="set-about">
                  {character.name}是一个 AI 角色，不是真人。她会陪你聊天、看视频、写日记，也会自己去逛逛。
                </p>
                <p className="set-about__meta">版本 {clientVersion}</p>
                <Button variant="ghost" className="set-about__again" onClick={reopenOnboarding}>
                  重新看一遍引导
                </Button>
              </SettingGroup>
            </section>
          </div>
        </div>
      </div>

      <CharacterDialog open={charOpen} onOpenChange={setCharOpen} relationship={relationship} />
      <Toaster />
    </div>
  );
}
