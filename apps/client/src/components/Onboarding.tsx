/**
 * 首次引导（规范 §7.5）：`wp.onboarded` 未设时全屏盖住，三步走完或随时跳过。
 *
 * 第 1 步是「真实形象舞台」：大肥鱼加载 Live2D，其他人格使用贴纸默认形象；
 * 一句招呼落在她脚下，点她有反应。
 * 顶部固定「第 N 步，共 3 步」+ 进度点。
 * 引导打开时把后面的应用整块收起，右栏历史 / 导航 / 旧聊天都不露；
 * 首屏只有：她 + 一句话 + 两个按钮（继续 / 跳过）。
 * 第 2、3 步沿用原来的昵称 / 角色卡与约定 / 字号。
 */
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useAvatarStatus } from "../avatar/avatar-state";
import type { AvatarEmotion } from "../avatar/model.config";
import { CHARACTERS, setCharacter, useCharacter, useModel } from "../characters";
import { putNickname } from "../lib/profile";
import { readA11y } from "../lib/a11y";
import { CharacterMark } from "./CharacterMark";
import { ELDER_MIN_SCALE, updateA11y } from "./settings/prefs";
import "../styles/onboarding.css";
import { Button } from "./ui/Button";
import { Input } from "./ui/Field";
import { m } from "../i18n";

const ONBOARDED_KEY = "wp.onboarded";
const Live2DStage = lazy(() => import("../avatar/Live2DStage").then((module) => ({ default: module.Live2DStage })));

/* ---------------- 「重新看一遍引导」用的小开关（设置页调 reopenOnboarding） ---------------- */

let forcedOpen = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true; // 隐私模式读不到：别拿一块关不掉的全屏挡人
  }
}

const isOpen = () => forcedOpen || !hasOnboarded();

/** 引导是不是正盖在最上面；App 用它决定后场景要不要挂（Live2D 的着色器是全局单例，同页两个舞台会互相打断）。 */
export const useOnboardingOpen = () => useSyncExternalStore(subscribe, isOpen);

/** 设置页底部「重新看一遍引导」。 */
export function reopenOnboarding() {
  forcedOpen = true;
  notify();
}

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch { /* 隐私模式：本次会话内仍然关掉 */ }
  forcedOpen = false;
  notify();
}

/* ---------------- 三步的文案（规范 §7.5 原文） ---------------- */

const AGREEMENTS = m.settings.onboarding.agreements;

const FONT_CHOICES = [
  { id: "std", label: m.settings.onboarding.fontStd, note: "" },
  { id: "big", label: m.settings.onboarding.fontBig, note: "" },
  { id: "huge", label: m.settings.onboarding.fontHuge, note: m.settings.onboarding.hugeNote },
] as const;

type FontChoice = (typeof FONT_CHOICES)[number]["id"];

const POKE_EMOTION: AvatarEmotion = "relaxed";
const POKE_MS = 1800;

export function Onboarding() {
  const open = useOnboardingOpen();
  const navigate = useNavigate();
  const character = useCharacter();
  const model = useModel();
  const avatar = useAvatarStatus();
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState("");
  const [a11y, setA11y] = useState(readA11y);
  const [picked, setPicked] = useState<string>(character.id);
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [poked, setPoked] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const pokeTimer = useRef<number | undefined>(undefined);

  // 盖住时别让人 Tab 到后面的页面上去；同时告诉样式层「现在在引导里」，把右栏历史等整块收起。
  useEffect(() => {
    if (!open) return;
    const app = document.querySelector(".app");
    const root = document.documentElement;
    app?.setAttribute("inert", "");
    root.setAttribute("data-onboarding", "on");
    return () => {
      app?.removeAttribute("inert");
      root.removeAttribute("data-onboarding");
    };
  }, [open]);

  // 焦点落在对话框本身（不落在按钮上，免得一进来就顶着焦点环）；Tab 再进控件。
  useEffect(() => {
    if (open) frameRef.current?.focus();
  }, [open, step]);

  useEffect(
    () => () => {
      if (pokeTimer.current !== undefined) window.clearTimeout(pokeTimer.current);
    },
    [],
  );

  if (!open) return null;

  const fontChoice: FontChoice = a11y.elder ? "huge" : a11y.scale >= 1.2 ? "big" : "std";

  const chooseFont = (id: FontChoice) => {
    if (id === "std") setA11y(updateA11y({ elder: false, scale: 1 }));
    else if (id === "big") setA11y(updateA11y({ elder: false, scale: ELDER_MIN_SCALE }));
    else setA11y(updateA11y({ elder: true, scale: ELDER_MIN_SCALE }));
  };

  const finish = (skipped: boolean) => {
    if (!skipped) {
      const trimmed = nickname.trim();
      if (trimmed) void putNickname(trimmed).catch(() => undefined); // 后端不在也不拦人
    }
    markOnboarded();
    setStep(0);
  };

  const next = () => {
    if (step < 2) setStep(step + 1);
    else finish(false);
  };

  // 点她：表情先给一下反应，嘴上回一句，1.8s 后回到原来的招呼。
  const pokeHer = () => {
    setPoked(true);
    setEmotion(POKE_EMOTION);
    if (pokeTimer.current !== undefined) window.clearTimeout(pokeTimer.current);
    pokeTimer.current = window.setTimeout(() => {
      setPoked(false);
      setEmotion("neutral");
      pokeTimer.current = undefined;
    }, POKE_MS);
  };

  const hello = m.settings.onboarding.hello(character.name);

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label={m.settings.onboarding.dialogLabel} tabIndex={-1} ref={frameRef}>
      <div className="onb__inner">
        <header className="onb__head">
          <p className="onb__progress">{m.settings.onboarding.progress(step + 1)}</p>
          <ol className="onb__beads" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li
                key={index}
                className="onb__bead"
                data-state={index === step ? "on" : index < step ? "done" : "off"}
              />
            ))}
          </ol>
        </header>

        <div className="onb__stage" data-step={step}>
          {step === 0 ? (
            <div className="onb__scene">
              <div
                className="onb__figure"
                role="button"
                tabIndex={0}
                aria-label={m.settings.onboarding.pokeAria(character.name)}
                onClick={pokeHer}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    pokeHer();
                  }
                }}
              >
                {/* 没有可用模型或加载失败时使用角色贴纸，首屏保持完整。 */}
                {(!model || avatar === "failed") && (
                  <div className="onb__sticker" aria-hidden="true">
                    <CharacterMark mood="wave" />
                  </div>
                )}
                {model && (
                  <Suspense fallback={null}>
                    <Live2DStage key={model.id} modelUrl={model.url} emotion={emotion} speaking={false} />
                  </Suspense>
                )}
              </div>

              <p className="onb__hint">{m.settings.onboarding.pokeHint}</p>

              <p className="onb__line">{poked ? m.settings.onboarding.pokeReply : hello}</p>
            </div>
          ) : (
            <>
              <div className="onb__her" aria-hidden="true">
                <CharacterMark mood={step === 1 ? "happy" : "calm"} />
              </div>

              {step === 1 && (
                <div className="onb__block">
                  <p className="onb__say">
                    {m.settings.onboarding.askName}
                    <br />
                    {m.settings.onboarding.askNameSub}
                  </p>
                  <Input className="onb__field"
                    type="text"
                    maxLength={12}
                    placeholder={m.settings.onboarding.namePlaceholder}
                    aria-label={m.settings.onboarding.nameAria}
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                  />
                  <p className="onb__sub">{m.settings.onboarding.pickOne}</p>
                  <ul className="onb__chars">
                    {CHARACTERS.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="onb__char"
                          aria-pressed={picked === item.id}
                          data-selected={picked === item.id ? "on" : "off"}
                          onClick={() => {
                            setPicked(item.id);
                            setCharacter(item.id);
                          }}
                        >
                          <span className="onb__char-name">{item.name}</span>
                          <span className="onb__char-tag">{item.tagline}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {step === 2 && (
                <div className="onb__block">
                  <p className="onb__say">{m.settings.onboarding.lastThree}</p>
                  <ol className="onb__pact">
                    {AGREEMENTS.map((line, index) => (
                      <li key={line}>
                        <span className="onb__num" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="onb__sub">{m.settings.onboarding.fontQuestion}</p>
                  <div className="onb__fonts" role="group" aria-label={m.settings.onboarding.fontGroup}>
                    {FONT_CHOICES.map((item) => (
                      <Button
                        key={item.id}
                        className="onb__font" variant={fontChoice === item.id ? "primary" : "secondary"}
                        aria-pressed={fontChoice === item.id}
                        data-selected={fontChoice === item.id ? "on" : "off"}
                        onClick={() => chooseFont(item.id)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                  {fontChoice === "huge" && <p className="onb__note">{m.settings.onboarding.hugeNoteAfter}</p>}
                  <p className="onb__sub">{m.settings.onboarding.needAccount}</p>
                  <Button
                    className="onb__model" variant="secondary"
                    onClick={() => {
                      finish(false);
                      navigate("/settings#model");
                    }}
                  >
                    {m.settings.onboarding.goSettings}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="onb__foot">
          <Button className="onb__skip" variant="ghost" onClick={() => finish(true)}>
            {m.settings.onboarding.skip}
          </Button>
          <Button className="onb__next" variant="primary" onClick={next}>
            {step === 0 ? m.settings.onboarding.next0 : step === 1 ? m.settings.onboarding.next1 : m.settings.onboarding.next2}
          </Button>
        </footer>
      </div>
    </div>
  );
}
