import { m } from "../i18n/index.ts";
export type CharacterId = "deepseek" | "claude" | "chatgpt" | "whale";

export interface AvatarModel {
  id: string;
  url: string;
  label: string;
  source: string;
  licenseNote: string;
  renderer: "live2d";
  ownerCharacterId: CharacterId;
}

export const AVATAR_MODELS: readonly AvatarModel[] = [
  {
    id: "dafeiyu-live2d",
    url: "/live2d/whale-maid/c_0120.model3.json",
    label: m.chat.model.label,
    source: m.chat.model.source,
    licenseNote: m.chat.model.licenseNote,
    renderer: "live2d",
    ownerCharacterId: "deepseek",
  },
];

export const DEFAULT_MODEL_BY_CHARACTER: Readonly<Record<CharacterId, string | null>> = {
  deepseek: "dafeiyu-live2d",
  claude: null,
  chatgpt: null,
  whale: null,
};

export function defaultModelFor(characterId: CharacterId, modelId: string | null): AvatarModel | null {
  if (!modelId) return null;
  return AVATAR_MODELS.find((model) => model.id === modelId && model.ownerCharacterId === characterId) ?? null;
}

export type AvatarEmotion = "neutral" | "happy" | "sad" | "angry" | "surprised" | "relaxed";
