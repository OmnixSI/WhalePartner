/**
 * Live2D 帧率调度：只有「在动」的时候才按显示器刷新率画。
 *
 *   active  有对话 / 语音 / 点击 / 指针 / 表情变化：ticker 正常跑（rAF）
 *   idle    静置超过 idleAfterMs：停掉 ticker，改由一个定时器每 idleFrameMs 手动推一帧
 *           （模型的待机呼吸、眨眼继续走，但只有 ~10fps，rAF 为 0）
 *   paused  窗口隐藏 / 舞台不在视口：什么都不跑，没有 rAF 也没有定时器
 *
 * 任何输入调 wake() 回到 active；isBusy() 为真时（正在说话、点击动作、弹跳）不会降档。
 */
export interface GovernedTicker {
  readonly started: boolean;
  start(): void;
  stop(): void;
  update(currentTime?: number): void;
}

export interface FrameGovernorOptions {
  ticker: GovernedTicker;
  /** 窗口隐藏或舞台不可见。 */
  isHidden: () => boolean;
  /** 说话 / 点击动作 / 弹跳等需要连续帧的状态。 */
  isBusy: () => boolean;
  idleAfterMs?: number;
  idleFrameMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export type FrameMode = "active" | "idle" | "paused";

export const IDLE_AFTER_MS = 2500;
/** 静置帧间隔：100ms = 10fps，也是 pixi Ticker 默认单帧时间上限（minFPS 10），超过会被截断而变慢。 */
export const IDLE_FRAME_MS = 100;
/** active 档下复查 isBusy 的间隔。 */
const BUSY_RECHECK_MS = 400;

export function createFrameGovernor(options: FrameGovernorOptions) {
  const { ticker, isHidden, isBusy } = options;
  const idleAfterMs = options.idleAfterMs ?? IDLE_AFTER_MS;
  const idleFrameMs = options.idleFrameMs ?? IDLE_FRAME_MS;
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => window.clearTimeout(id as number));

  let mode: FrameMode = "active";
  let lastActivity = now();
  let timer: unknown;
  let disposed = false;

  const cancel = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  const enterIdle = () => {
    mode = "idle";
    if (ticker.started) ticker.stop();
    const step = () => {
      timer = undefined;
      if (disposed) return;
      if (isHidden() || isBusy()) {
        evaluate();
        return;
      }
      ticker.update(now());
      timer = setTimer(step, idleFrameMs);
    };
    timer = setTimer(step, idleFrameMs);
  };

  function evaluate() {
    if (disposed) return;
    cancel();
    if (isHidden()) {
      mode = "paused";
      if (ticker.started) ticker.stop();
      return;
    }
    if (isBusy()) lastActivity = now();
    const quiet = now() - lastActivity;
    if (quiet >= idleAfterMs) {
      enterIdle();
      return;
    }
    mode = "active";
    if (!ticker.started) ticker.start();
    timer = setTimer(evaluate, isBusy() ? BUSY_RECHECK_MS : idleAfterMs - quiet);
  }

  evaluate();

  return {
    /** 有输入或状态变化：回到 active，并重新计静置时间。 */
    wake() {
      lastActivity = now();
      if (mode !== "active") evaluate();
    },
    /** 可见性变了：重新判断。 */
    sync: evaluate,
    mode: () => mode,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
