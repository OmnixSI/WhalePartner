import { CHARACTERS, type Character } from "../characters";
import { defaultModelFor, type AvatarModel } from "../avatar/model.config";

export type CardCharacter = Character & { model: AvatarModel | null };

export const CARD_CHARACTERS: readonly CardCharacter[] = CHARACTERS.map((character) => ({
  ...character,
  model: defaultModelFor(character.id, character.modelId),
}));

export const RELATIONSHIP_SAMPLES = [
  { level: 1, label: "相识", points: 0, next: 25, effect: "基础卡面", detail: "静态立绘与基础卡框" },
  { level: 2, label: "相熟", points: 25, next: 100, effect: "立体效果", detail: "视角倾斜与人物、背景分层视差" },
  { level: 3, label: "默契", points: 100, next: 250, effect: "动态画面", detail: "Live2D 待机与流动能量光" },
  { level: 4, label: "亲近", points: 250, next: 250, effect: "专属特效", detail: "随卡面浮动的粒子与动态光照" },
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
