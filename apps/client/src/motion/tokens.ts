/**
 * 动效参数（重设计规范 §8.1）。
 *
 * 组件**不得**手写 stiffness / damping / duration —— 全部从这里取。
 * CSS 里的时长与曲线在 `styles/tokens.css` 的 `--dur-*` / `--ease-*`，
 * 弹簧只能在 motion 组件里用，所以两边各有一份「唯一真相」。
 *
 * 只动 transform / opacity；例外只有墨线 clip-path 与折叠 grid-template-rows（§8.1）。
 * 缓动：入 `--ease-out`，循环 `--ease-inout`；线性只给浪漂移。
 */

/** 弹簧。默认几乎没有回弹；`cute` 只给邮戳/收藏/角色被点这类小奖励。 */
export const spring = {
  press: { type: "spring", stiffness: 520, damping: 32 }, // 按下回弹，无过冲
  soft: { type: "spring", stiffness: 300, damping: 30 }, // 默认 UI（几乎无回弹）
  sheet: { type: "spring", stiffness: 260, damping: 32 }, // 抽屉
  page: { type: "spring", stiffness: 260, damping: 28 }, // 翻页
  switch: { type: "spring", stiffness: 500, damping: 30 },
  cute: { type: "spring", stiffness: 400, damping: 17 }, // 仅：邮戳、收藏、角色被点
  char: { type: "spring", stiffness: 170, damping: 18, mass: 1 }, // 角色入场
} as const;

/** 时长（秒，motion 的单位）。与 tokens.css 的 --dur-* 一一对应。 */
export const dur = {
  press: 0.12,
  hover: 0.16,
  fade: 0.2,
  panel: 0.28,
  ink: 0.24,
  page: 0.52,
} as const;

/**
 * calm / reduced-motion 的降级：不位移、只淡入。
 * §8.2 的 reduced-motion 列到处是「120ms 淡入」，集中成一份。
 */
export const calmFade = { duration: dur.press } as const;
