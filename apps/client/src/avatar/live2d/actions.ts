import type { AvatarEmotion } from "../model.config";
import type { Cubism4MotionManager } from "pixi-live2d-display/cubism4";
import type { HitRegion } from "./hit";

export const EMOTION_EXPRESSIONS: Partial<Record<AvatarEmotion, string>> = {
  happy: "开心兴奋",
  sad: "悲伤",
  angry: "生气",
  surprised: "问号",
  relaxed: "脸红",
};

const TAP_EXPRESSIONS: Readonly<Record<string, string>> = {
  Hammer: "感叹号",
  BubbleGum: "吐舌",
  SprayWater: "流汗",
  OpenCase: "问号",
  Selfie: "爱心眼",
  SelfieQuick: "双手比耶",
  Ketchup: "调皮",
};

const MAX_TAP_ACTION_SECONDS = 3.5;

export interface TapAction {
  group: string;
  index: number;
  expression?: string;
  /** 秒；仅超长动作（> MAX_TAP_ACTION_SECONDS）会带上，由看门狗在上限处截断。 */
  duration?: number;
}

/**
 * 读取本模型可用于点击的动作：优先 ≤3.5s 的短动作；一个短动作都没有时，
 * 把长动作也收进来（带 duration，看门狗在上限处截断），而不是让点击没反应。
 */
export async function loadTapActions(manager: Cubism4MotionManager): Promise<TapAction[]> {
  const candidates = Object.entries(manager.definitions)
    .filter(([group]) => group !== manager.groups.idle)
    .flatMap(([group, definitions]) => (definitions ?? []).map((_, index) => ({ group, index })));
  const short: TapAction[] = [];
  const long: TapAction[] = [];
  await Promise.all(candidates.map(async ({ group, index }) => {
    try {
      const motion = await manager.loadMotion(group, index);
      if (!motion) return;
      // Cubism 4 用 getDuration()（秒）；Cubism 2 用 getDurationMSec()（毫秒）。
      const loose = motion as unknown as { getDuration?: () => number; getDurationMSec?: () => number; setIsLoop?: (loop: boolean) => void; setLoop?: (loop: boolean) => void };
      const duration = loose.getDuration?.() ?? (loose.getDurationMSec ? loose.getDurationMSec() / 1000 : 0);
      if (!(duration > 0)) return;
      (loose.setIsLoop ?? loose.setLoop)?.call(motion, false);
      const expression = TAP_EXPRESSIONS[group];
      const base: TapAction = expression ? { group, index, expression } : { group, index };
      if (duration <= MAX_TAP_ACTION_SECONDS) short.push(base);
      else long.push({ ...base, duration });
    } catch {
      /* 单个动作读不出来就跳过 */
    }
  }));
  const order = (a: TapAction, b: TapAction) => a.group.localeCompare(b.group) || a.index - b.index;
  return (short.length ? short : long).sort(order);
}

const REGION_GROUP: Record<HitRegion, RegExp> = {
  head: /head|face|頭|头|脸/i,
  body: /body|chest|belly|身|胸|腹/i,
};

export function chooseTapAction(
  actions: readonly TapAction[],
  random = Math.random,
  region?: HitRegion,
): TapAction | null {
  if (actions.length === 0) return null;
  const matched = region ? actions.filter((action) => REGION_GROUP[region].test(action.group)) : [];
  const pool = matched.length ? matched : actions;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index] ?? null;
}
