import { m } from "../i18n/index.ts";
import type { RelationshipProgress, RelationshipSample } from "./data";

/** 卡片说明里的等级一句话。真实好感度以接口返回的名称和效果为准；样本表没有的档位（目前是 Lv5 镀闪）说明暂按最高的已有卡面显示。 */
export function levelIntro(sample: RelationshipSample, relationship?: RelationshipProgress | null): string {
  if (!relationship) return m.cards.relationship.sampleIntro(sample.level, sample.effect, sample.detail);
  return relationship.level === sample.level
    ? m.cards.relationship.matchedIntro(relationship.level, relationship.effect, sample.detail)
    : m.cards.relationship.notLiveIntro(relationship.level, relationship.effect, sample.level);
}

/** 真实好感度下的“下一档”提示：以接口的 nextThreshold 为准，null 才是满级。 */
export function nextStageText(relationship: Pick<RelationshipProgress, "points" | "nextThreshold" | "effect">): string {
  return relationship.nextThreshold === null
    ? m.cards.relationship.maxUnlocked(relationship.effect)
    : m.cards.relationship.nextStage(Math.max(0, relationship.nextThreshold - relationship.points));
}
