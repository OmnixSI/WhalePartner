/**
 * 首次引导（规范 §7.5）：`wp.onboarded` 未设时全屏盖住，三步走完或随时跳过。
 *
 * 第 1 步是「真实形象舞台」：不复用贴纸，直接挂聊天页同一套舞台（Live2D / VRM 按
 * model.renderer 分流），让她本人站在那儿；一句招呼落在她脚下，点她有反应。
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
import { Tide } from "./ink";
import { ELDER_MIN_SCALE, updateA11y } from "./settings/prefs";
import "../styles/settings.css";

const ONBOARDED_KEY = "wp.onboarded";
const Live2DStage = lazy(() => import("../avatar/Live2DStage").then((module) => ({ default: module.Live2DStage })));
const VrmStage = lazy(() => import("../avatar/VrmStage").then((module) => ({ default: module.VrmStage })));

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

const AGREEMENTS = [
  "我们的聊天只存在这台设备上。",
  "你随时可以导出，也可以删掉一切。",
  "我不会向你要验证码、银行卡，也不会让你转账。",
];

const FONT_CHOICES = [
  { id: "std", label: "Aa 标准", note: "" },
  { id: "big", label: "Aa 大", note: "" },
  { id: "huge", label: "Aa 特别大", note: "大字、大按钮、只留三个入口。" },
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

  const hello = `你好呀，我是${character.name}——一个会陪你聊天、替你看看视频的 AI 角色。`;

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="第一次见面，三步就好" tabIndex={-1} ref={frameRef}>
      <div className="onb__tide" aria-hidden="true">
        <Tide variant="stage" />
      </div>

      <div className="onb__inner">
        <header className="onb__head">
          <p className="onb__progress">第 {step + 1} 步，共 3 步</p>
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
                aria-label={`点一点${character.name}`}
                onClick={pokeHer}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    pokeHer();
                  }
                }}
              >
                {/* 真形象加载不出来时才退回贴纸，别让首屏空白 */}
                {avatar === "failed" && (
                  <div className="onb__sticker" aria-hidden="true">
                    <CharacterMark mood="wave" />
                  </div>
                )}
                {/* 大肥鱼是 Live2D，其余是 VRM；按清单里的 renderer 分流，别拿 .model3.json 去喂 VRM 加载器 */}
                <Suspense fallback={null}>
                  {model.renderer === "live2d" ? (
                    <Live2DStage key={model.id} modelUrl={model.url} emotion={emotion} speaking={false} />
                  ) : (
                    <VrmStage key={model.id} modelUrl={model.url} emotion={emotion} speaking={false} />
                  )}
                </Suspense>
              </div>

              <p className="onb__hint">点一点她，她会看你哦。</p>

              <p className="onb__line">{poked ? "嗯？我在呢。" : hello}</p>
            </div>
          ) : (
            <>
              <div className="onb__her" aria-hidden="true">
                <CharacterMark mood={step === 1 ? "happy" : "calm"} />
              </div>

              {step === 1 && (
                <div className="onb__block">
                  <p className="onb__say">
                    你想让我怎么叫你？
                    <br />
                    不想说也没关系。
                  </p>
                  <input
                    className="field onb__field"
                    type="text"
                    maxLength={12}
                    placeholder="不想说也没关系"
                    aria-label="你想让我怎么称呼你"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                  />
                  <p className="onb__sub">选一位陪你</p>
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
                  <p className="onb__say">最后说三件小事。</p>
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
                  <p className="onb__sub">字看得清吗？</p>
                  <div className="onb__fonts" role="group" aria-label="字号">
                    {FONT_CHOICES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="btn btn--secondary onb__font"
                        aria-pressed={fontChoice === item.id}
                        data-selected={fontChoice === item.id ? "on" : "off"}
                        onClick={() => chooseFont(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {fontChoice === "huge" && <p className="onb__note">大字、大按钮、只留三个入口。以后在设置里还能改。</p>}
                  <p className="onb__sub">她要接上账号才能说话。</p>
                  <button
                    type="button"
                    className="btn btn--secondary onb__model"
                    onClick={() => {
                      finish(false);
                      navigate("/settings#model");
                    }}
                  >
                    去设置里接上她的账号
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="onb__foot">
          <button type="button" className="btn btn--quiet onb__skip" onClick={() => finish(true)}>
            跳过，以后再说
          </button>
          <button type="button" className="btn btn--primary onb__next" onClick={next}>
            {step === 0 ? "继续" : step === 1 ? "就这样" : "开始吧"}
          </button>
        </footer>
      </div>
    </div>
  );
}
