import { m } from "../i18n/index.ts";
import { CHARACTERS, type Character } from "../characters";
import { defaultModelFor, type AvatarModel } from "../avatar/model.config";

export type CardCharacter = Character & { model: AvatarModel | null };

export const CARD_CHARACTERS: readonly CardCharacter[] = CHARACTERS.map((character) => ({
  ...character,
  model: defaultModelFor(character.id, character.modelId),
}));

export const RELATIONSHIP_SAMPLES = [
  { level: 1, label: m.cards.tiers.acquainted, points: 0, next: 25, effect: m.cards.samples.basicEffect, detail: m.cards.samples.basicDetail },
  { level: 2, label: m.cards.tiers.familiar, points: 25, next: 100, effect: m.cards.samples.depthEffect, detail: m.cards.samples.depthDetail },
  { level: 3, label: m.cards.tiers.inSync, points: 100, next: 250, effect: m.cards.samples.liveEffect, detail: m.cards.samples.liveDetail },
  { level: 4, label: m.cards.tiers.close, points: 250, next: 250, effect: m.cards.samples.specialEffect, detail: m.cards.samples.specialDetail },
] as const;

export type RelationshipSample = typeof RELATIONSHIP_SAMPLES[number];

export type RelationshipProgress = {
  points: number;
  level: number;
  label: string;
  effect: string;
  nextThreshold: number | null;
  progress: number;
};
