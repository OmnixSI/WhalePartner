/**
 * 窗口隐藏 / 用户空闲时让页面「停下来」（#151 性能预算：语音识别和 TTS 跟界面抢同一台机器）。
 *
 * - 窗口隐藏（最小化、切到别的应用标签）：根元素加 data-hidden，base.css 暂停所有 CSS 动画。
 * - 空闲 IDLE_MS 没有任何输入：根元素加 data-idle，暂停环境动画（海浪、潮汐这类纯装饰的循环）。
 *   表示状态的动画（加载、录音、思考中）不受空闲影响——它们只在那个状态里存在。
 *
 * 不用常驻定时器：只有一个 setTimeout，有输入时记下时间，到点检查一次；进入空闲后不再续。
 * 页面里自己的轮询（presence、健康检查等）用 isHidden() / onVisibilityChange() 跳过隐藏期。
 */
export const IDLE_MS = 8000;

const root = document.documentElement;
let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const hidden = () => document.visibilityState === "hidden";
export const isHidden = hidden;

function arm(delay: number) {
  if (timer !== null) return;
  timer = setTimeout(check, delay);
}

function check() {
  timer = null;
  if (hidden()) return;
  const rest = IDLE_MS - (performance.now() - last);
  if (rest > 50) arm(rest);
  else root.setAttribute("data-idle", "");
}

function active() {
  last = performance.now();
  if (root.hasAttribute("data-idle")) root.removeAttribute("data-idle");
  if (!hidden()) arm(IDLE_MS);
}

function onVisibility() {
  if (hidden()) {
    root.setAttribute("data-hidden", "");
    if (timer !== null) { clearTimeout(timer); timer = null; }
  } else {
    root.removeAttribute("data-hidden");
    active();
  }
}

let installed = false;
export function installActivity() {
  if (installed) return;
  installed = true;
  const opts = { capture: true, passive: true } as const;
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focusin"]) {
    window.addEventListener(type, active, opts);
  }
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();
}

/** 订阅可见性变化（轮询在隐藏时停、回来时补一次）；返回取消订阅函数 */
export function onVisibilityChange(fn: (visible: boolean) => void) {
  const h = () => fn(!hidden());
  document.addEventListener("visibilitychange", h);
  return () => document.removeEventListener("visibilitychange", h);
}
