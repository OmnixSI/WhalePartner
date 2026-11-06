// 老人模式 / 字号 / 安静模式（规范 §4.8）。存 localStorage：wp.elder("on"|"off")、wp.scale("1".."1.5")、wp.motion("calm"|"full")。
export function applyA11y({ elder, scale, calm }: { elder: boolean; scale: number; calm: boolean }) {
  const root = document.documentElement;
  root.setAttribute("data-elder", elder ? "on" : "off");
  root.style.setProperty("--scale", String(elder ? Math.max(scale, 1.25) : scale)); // 老人模式字号下限 1.25
  root.setAttribute("data-motion", elder || calm ? "calm" : "full");
}

export type A11yPrefs = { elder: boolean; scale: number; calm: boolean };

/** 从 localStorage 还原偏好；theme-boot.js 已在首帧前写过同样的值。 */
export function readA11y(): A11yPrefs {
  let elder = false, scale = 1, calm = false;
  try {
    elder = localStorage.getItem("wp.elder") === "on";
    const s = Number(localStorage.getItem("wp.scale") || 1);
    if (isFinite(s) && s > 0) scale = s;
    calm = localStorage.getItem("wp.motion") === "calm";
  } catch { /* 隐私模式 */ }
  return { elder, scale, calm };
}
