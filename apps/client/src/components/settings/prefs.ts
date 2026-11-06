/**
 * 「方便我用」的偏好落盘（规范 §9.1）：`wp.elder` / `wp.scale` / `wp.motion`。
 *
 * 真正的实施在 `lib/a11y.ts`（`applyA11y` 负责 data-elder / --scale / data-motion）；
 * 这里只补上"改完要立刻生效 + 下次开还是这样"这一步，供设置页与引导第 3 步共用。
 */
import { applyA11y, readA11y, type A11yPrefs } from "../../lib/a11y";

const ELDER_KEY = "wp.elder";
const SCALE_KEY = "wp.scale";
const MOTION_KEY = "wp.motion";

/** 老人模式字号下限（规范 §9.1：--scale ≥ 1.25）。 */
export const ELDER_MIN_SCALE = 1.25;
export const SCALE_MIN = 1;
export const SCALE_MAX = 1.5;

/** 写 localStorage + 立刻 apply；隐私模式下写不进去也要先让界面对。 */
export function saveA11y(next: A11yPrefs) {
  const value: A11yPrefs = {
    elder: next.elder,
    scale: next.elder ? Math.max(next.scale, ELDER_MIN_SCALE) : next.scale,
    calm: next.calm,
  };
  try {
    localStorage.setItem(ELDER_KEY, value.elder ? "on" : "off");
    localStorage.setItem(SCALE_KEY, String(value.scale));
    localStorage.setItem(MOTION_KEY, value.calm ? "calm" : "full");
  } catch { /* 隐私模式：只影响下次启动 */ }
  applyA11y(value);
}

/** 改一项，其余沿用当前值；返回合并后的结果（给 React state 用）。 */
export function updateA11y(patch: Partial<A11yPrefs>): A11yPrefs {
  const next = { ...readA11y(), ...patch };
  saveA11y(next);
  return { ...next, scale: next.elder ? Math.max(next.scale, ELDER_MIN_SCALE) : next.scale };
}

export { readA11y };
