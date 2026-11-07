/**
 * 点击反应状态机（纯函数，无 DOM / Pixi 依赖，便于单测）。
 *
 * 旧实现用一个 `actionActive` 布尔量拒绝新点击，只有 motionFinish 才复位；
 * 一旦动作被抢占，motionFinish 永不触发，之后所有点击都静默无反应。
 * 这里改成：
 *   - 每次点击都开启一个新的 seq（FORCE 优先级打断当前动作），永不拒绝；
 *   - 每个动作带 deadline（动作时长 + 500ms，上限 4s），tick 到点强制复位；
 *   - 只接受当前 seq 的 motionFinish，过期的完成事件被忽略。
 */
import type { TapAction } from "./actions";
import type { HitRegion } from "./hit";

export const WATCHDOG_PAD_MS = 500;
export const WATCHDOG_MAX_MS = 4000;
/** 兜底反应（换表情 + 弹一下）持续多久。 */
export const FALLBACK_MS = 900;

export interface FallbackReaction {
  expression?: string;
  /** 弹跳幅度，占模型高度的比例。 */
  bounce: number;
}

export interface TapState {
  phase: "idle" | "acting";
  seq: number;
  deadline: number;
}

export type TapEvent =
  | { type: "tap"; now: number; region: HitRegion }
  | { type: "motionFinish"; seq: number }
  | { type: "tick"; now: number }
  | { type: "dispose" };

export type TapEffect =
  | { type: "play"; seq: number; region: HitRegion; action: TapAction | null; fallback: FallbackReaction }
  | { type: "reset"; seq: number; reason: "finished" | "watchdog" | "dispose" };

export interface TapContext {
  actions: readonly TapAction[];
  expressions: readonly string[];
  random: () => number;
  /** 选动作（actions.ts 的 chooseTapAction）；注入而不是 import，保持本文件零运行时依赖。 */
  choose: (actions: readonly TapAction[], random: () => number, region: HitRegion) => TapAction | null;
}

export const initialTapState: TapState = { phase: "idle", seq: 0, deadline: 0 };

export function watchdogMs(action: TapAction | null): number {
  if (!action) return FALLBACK_MS;
  const base = Number.isFinite(action.duration) && (action.duration ?? 0) > 0 ? (action.duration as number) * 1000 : WATCHDOG_MAX_MS;
  return Math.min(base + WATCHDOG_PAD_MS, WATCHDOG_MAX_MS);
}

/** 没有可用动作时的兜底：头部轻柔（换表情 + 小弹），身体更明显（小弹更大）。 */
export function fallbackFor(region: HitRegion, expressions: readonly string[], random: () => number): FallbackReaction {
  const expression = expressions.length
    ? expressions[Math.min(expressions.length - 1, Math.floor(random() * expressions.length))]
    : undefined;
  return { expression, bounce: region === "head" ? 0.018 : 0.03 };
}

export function reduceTap(state: TapState, event: TapEvent, ctx: TapContext): { state: TapState; effects: TapEffect[] } {
  switch (event.type) {
    case "tap": {
      const action = ctx.choose(ctx.actions, ctx.random, event.region);
      const seq = state.seq + 1;
      return {
        state: { phase: "acting", seq, deadline: event.now + watchdogMs(action) },
        effects: [{ type: "play", seq, region: event.region, action, fallback: fallbackFor(event.region, ctx.expressions, ctx.random) }],
      };
    }
    case "motionFinish":
      if (state.phase !== "acting" || event.seq !== state.seq) return { state, effects: [] };
      return { state: { ...state, phase: "idle" }, effects: [{ type: "reset", seq: state.seq, reason: "finished" }] };
    case "tick":
      if (state.phase !== "acting" || event.now < state.deadline) return { state, effects: [] };
      return { state: { ...state, phase: "idle" }, effects: [{ type: "reset", seq: state.seq, reason: "watchdog" }] };
    case "dispose":
      if (state.phase !== "acting") return { state, effects: [] };
      return { state: { ...state, phase: "idle" }, effects: [{ type: "reset", seq: state.seq, reason: "dispose" }] };
  }
}
