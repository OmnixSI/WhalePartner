import type { AvatarEmotion } from "../model.config";
import type { Cubism4MotionManager } from "pixi-live2d-display/cubism4";

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
}

/** Load only short actions present in this model; interaction clips must play once. */
export async function loadTapActions(manager: Cubism4MotionManager): Promise<TapAction[]> {
  const candidates = Object.entries(manager.definitions)
    .filter(([group]) => group !== manager.groups.idle)
    .flatMap(([group, definitions]) => (definitions ?? []).map((_, index) => ({ group, index })));
  const loaded = await Promise.all(candidates.map(async ({ group, index }) => {
    try {
      const motion = await manager.loadMotion(group, index);
      const duration = motion?.getDuration() ?? 0;
      if (!motion || duration <= 0 || duration > MAX_TAP_ACTION_SECONDS) return null;
      motion.setIsLoop(false);
      const expression = TAP_EXPRESSIONS[group];
      return expression ? { group, index, expression } : { group, index };
    } catch {
      return null;
    }
  }));
  return loaded.filter((action): action is TapAction => action !== null);
}

export function chooseTapAction(actions: readonly TapAction[], random = Math.random): TapAction | null {
  if (actions.length === 0) return null;
  const index = Math.min(actions.length - 1, Math.floor(random() * actions.length));
  return actions[index] ?? null;
}
