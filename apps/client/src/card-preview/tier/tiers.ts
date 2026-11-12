/**
 * 好感度卡五档（#159）：档位名与门槛跟后端 `apps/api/src/relationship/policy.ts` 的 RELATIONSHIP_STAGES 一致
 * （Lv5 相依 500 来自 #158）。卡面只认 level，门槛只给预览页写说明用；接真实数据（#160）时以接口返回为准。
 */
export type CardLevel = 1 | 2 | 3 | 4 | 5;

export type CardTier = {
  level: CardLevel;
  /** 后端阶段名 */
  label: string;
  /** 后端门槛（仅演示与文案） */
  threshold: number;
  /** 卡面材质的名字，写在预览页和读屏文字里 */
  finish: string;
};

export const CARD_TIERS: readonly CardTier[] = [
  { level: 1, label: "相识", threshold: 0, finish: "素纸" },
  { level: 2, label: "相熟", threshold: 25, finish: "银衬" },
  { level: 3, label: "默契", threshold: 100, finish: "潮光" },
  { level: 4, label: "亲近", threshold: 250, finish: "金缘" },
  { level: 5, label: "相依", threshold: 500, finish: "镀闪" },
];

export const MAX_CARD_LEVEL: CardLevel = 5;

export function clampLevel(level: number): CardLevel {
  if (!Number.isFinite(level)) return 1;
  return Math.min(MAX_CARD_LEVEL, Math.max(1, Math.floor(level))) as CardLevel;
}

export function tierOf(level: number): CardTier {
  return CARD_TIERS[clampLevel(level) - 1];
}

/**
 * 每档卡面带来的能力，给接入方判断要不要接指针倾斜等。Live2D 立绘不分档：有模型的角色每一档都用 Live2D。
 * 卡面自己按 level 决定视觉，这里只是把规则写成一处。
 */
export function tierFeatures(level: number) {
  const l = clampLevel(level);
  return {
    tilt: l >= 2,
    signature: l >= 4,
    foil: l >= 5,
  };
}

/** 单步升级动画时长（ms），键是升到的档位。完整动效用；降级动效统一 CALM_STEP_MS。 */
export const UPGRADE_STEP_MS: Record<2 | 3 | 4 | 5, number> = { 2: 650, 3: 950, 4: 1250, 5: 1800 };
export const CALM_STEP_MS = 450;
/** 跨多档时整段不超过这个时长，逐档等比快进（#160 的约定）。 */
export const UPGRADE_CHAIN_MAX_MS = 3000;

export type UpgradeStep = { from: CardLevel; to: CardLevel; ms: number };

/** from→to 拆成逐档的步骤；from ≥ to 时返回空数组（不播）。 */
export function upgradeSteps(from: number, to: number, calm = false): UpgradeStep[] {
  const a = clampLevel(from);
  const b = clampLevel(to);
  if (a >= b) return [];
  const steps: UpgradeStep[] = [];
  for (let l = a; l < b; l += 1) {
    const next = (l + 1) as 2 | 3 | 4 | 5;
    steps.push({ from: l as CardLevel, to: next, ms: calm ? CALM_STEP_MS : UPGRADE_STEP_MS[next] });
  }
  const total = steps.reduce((n, s) => n + s.ms, 0);
  if (total > UPGRADE_CHAIN_MAX_MS) {
    const k = UPGRADE_CHAIN_MAX_MS / total;
    for (const s of steps) s.ms = Math.floor(s.ms * k); // 向下取整，合计不会超过上限
  }
  return steps;
}
