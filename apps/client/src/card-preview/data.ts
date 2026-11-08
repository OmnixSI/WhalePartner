import { CHARACTERS, type Character } from "../characters";
import { defaultModelFor, type AvatarModel } from "../avatar/model.config";

export type CardCharacter = Character & { model: AvatarModel | null };

export const CARD_CHARACTERS: readonly CardCharacter[] = CHARACTERS.map((character) => ({
  ...character,
  model: defaultModelFor(character.id, character.modelId),
}));

export const RELATIONSHIP_SAMPLES = [
  { level: 1, label: "初识", points: 0, next: 180, effect: "普通静态卡面", detail: "静态立绘与基础卡框" },
  { level: 2, label: "相熟", points: 180, next: 520, effect: "立体效果", detail: "视角倾斜与人物、背景分层视差" },
  { level: 3, label: "默契", points: 520, next: 920, effect: "动态画面", detail: "Live2D 待机与流动能量光" },
  { level: 4, label: "亲近", points: 920, next: 1500, effect: "专属特效", detail: "随卡面浮动的粒子与动态光照" },
  { level: 5, label: "相依", points: 1500, next: 1500, effect: "镀闪卡面", detail: "由全息镀膜 Shader 驱动的角度彩光" },
] as const;

export type RelationshipSample = typeof RELATIONSHIP_SAMPLES[number];
