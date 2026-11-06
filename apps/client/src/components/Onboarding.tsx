/**
 * 首次引导（规范 §7.5）：`wp.onboarded` 未设时全屏盖住，三步走完或随时跳过。
 *
 * 通用约定：顶部三颗贝壳 + 「第 N 步，共 3 步」；底部固定位置的主动作；
 * 每步左下都有 quiet「跳过，以后再说」；不出现 API Key / 模型 / 插件字样；
 * 全程键盘可达。第 3 步可以直接打开老人模式。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CHARACTERS, setCharacter, useCharacter } from "../characters";
import { putNickname } from "../lib/profile";
import { readA11y } from "../lib/a11y";
import { WhaleSticker } from "./WhaleSticker";
import { Tide } from "./ink";
import { ELDER_MIN_SCALE, updateA11y } from "./settings/prefs";
import "../styles/settings.css";

const ONBOARDED_KEY = "wp.onboarded";

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

export function Onboarding() {
  const open = useSyncExternalStore(subscribe, isOpen);
  const character = useCharacter();
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState("");
  const [a11y, setA11y] = useState(readA11y);
  const [picked, setPicked] = useState<string>(character.id);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // 盖住时别让人 Tab 到后面的页面上去。
  useEffect(() => {
    if (!open) return;
    const app = document.querySelector(".app");
    app?.setAttribute("inert", "");
    return () => app?.removeAttribute("inert");
  }, [open]);

  // 焦点落在对话框本身（不落在按钮上，免得一进来就顶着焦点环）；Tab 再进控件。
  useEffect(() => {
    if (open) frameRef.current?.focus();
  }, [open, step]);

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

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="第一次见面，三步就好" tabIndex={-1} ref={frameRef}>
      <div className="onb__tide" aria-hidden="true">
        <Tide variant="stage" />
      </div>

      <div className="onb__inner">
        <header className="onb__head">
          <p className="onb__beads" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span key={index} className="onb__bead" data-on={index === step ? "on" : "off"} />
            ))}
          </p>
          <p className="onb__progress">
            第 {step + 1} 步，共 3 步
          </p>
        </header>

        <div className="onb__stage">
          <div className="onb__her" aria-hidden="true">
            <WhaleSticker mood={step === 0 ? "wave" : step === 1 ? "happy" : "calm"} />
          </div>

          {step === 0 && (
            <div className="onb__block">
              <p className="onb__say">
                你好呀，我是{character.name}。
                <br />
                我是一个 AI 角色，不是真人。我会陪你聊天，也会替你看看视频、写写日记。
              </p>
            </div>
          )}

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
            </div>
          )}
        </div>

        <footer className="onb__foot">
          <button type="button" className="btn btn--quiet onb__skip" onClick={() => finish(true)}>
            跳过，以后再说
          </button>
          <button type="button" className="btn btn--primary onb__next" onClick={next}>
            {step === 0 ? "你好呀" : step === 1 ? "就这样" : "开始吧"}
          </button>
        </footer>
      </div>
    </div>
  );
}
