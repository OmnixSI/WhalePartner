import { CHARACTERS, type Character } from "../characters";
import { defaultModelFor, type AvatarModel } from "../avatar/model.config";

export type CardCharacter = Character & { model: AvatarModel | null };

export const CARD_CHARACTERS: readonly CardCharacter[] = CHARACTERS.map((character) => ({
  ...character,
  model: defaultModelFor(character.id, character.modelId),
}));

export const RELATIONSHIP_SAMPLES = [
  { label: "初识", points: 0, next: 180 },
  { label: "相熟", points: 180, next: 520 },
  { label: "默契", points: 520, next: 920 },
  { label: "亲近", points: 920, next: 920 },
] as const;

export const ADVANCED_EFFECT_LEVEL = 2;
