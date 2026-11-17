import type { Emotion } from "../chat/emotion.ts";
import { msg } from "../i18n/index.ts";

export const AFFINITY_PER_COMPLETED_DEEPSEEK_TURN = 1;
export const AFFINITY_DAILY_LIMIT = 10;
export const MOOD_RECOVERY_MS = 100 * 60_000;

export const RELATIONSHIP_STAGES = [
  { level: 1, threshold: 0, label: "相识", effect: "基础卡面" }, // i18n-ignore：仅作档位键，界面文字取自 msg().content.relationship.stages
  { level: 2, threshold: 25, label: "相熟", effect: "立体效果" }, // i18n-ignore：仅作档位键，界面文字取自 msg().content.relationship.stages
  { level: 3, threshold: 100, label: "默契", effect: "动态画面" }, // i18n-ignore：仅作档位键，界面文字取自 msg().content.relationship.stages
  { level: 4, threshold: 250, label: "亲近", effect: "专属特效" }, // i18n-ignore：仅作档位键，界面文字取自 msg().content.relationship.stages
  { level: 5, threshold: 500, label: "相依", effect: "镀闪卡面" }, // i18n-ignore：仅作档位键，界面文字取自 msg().content.relationship.stages
] as const;
type RelationshipStage = (typeof RELATIONSHIP_STAGES)[number];

export interface RelationshipMood {
  emotion: Emotion;
  intensity: number;
  updatedAt: string | null;
}

export interface RelationshipSnapshot {
  points: number;
  level: number;
  label: string;
  effect: string;
  nextThreshold: number | null;
  progress: number;
  mood: RelationshipMood;
}

export function relationshipSnapshot(points: number, mood: RelationshipMood): RelationshipSnapshot {
  const boundedPoints = Math.max(0, Math.floor(points));
  let stage: RelationshipStage = RELATIONSHIP_STAGES[0];
  for (const candidate of RELATIONSHIP_STAGES) {
    if (boundedPoints >= candidate.threshold) stage = candidate;
  }
  const next = RELATIONSHIP_STAGES.find((candidate) => candidate.level === stage.level + 1);
  // 未满级时最高 99：进度 100 只表示已到最高档（nextThreshold 为 null）。
  const progress = next
    ? Math.min(99, Math.max(0, Math.round(((boundedPoints - stage.threshold) / (next.threshold - stage.threshold)) * 100)))
    : 100;
  return {
    points: boundedPoints,
    level: stage.level,
    label: msg().content.relationship.stages[stage.level - 1].label,
    effect: msg().content.relationship.stages[stage.level - 1].effect,
    nextThreshold: next?.threshold ?? null,
    progress,
    mood,
  };
}

export function recoverMood(emotion: Emotion, intensity: number, updatedAt: string | null, now: Date): RelationshipMood {
  if (!updatedAt || emotion === "neutral") return { emotion: "neutral", intensity: 0, updatedAt };
  const age = Math.max(0, now.getTime() - Date.parse(updatedAt));
  const recovered = Math.max(0, Math.round(intensity * (1 - age / MOOD_RECOVERY_MS)));
  return recovered < 10
    ? { emotion: "neutral", intensity: 0, updatedAt }
    : { emotion, intensity: recovered, updatedAt };
}
