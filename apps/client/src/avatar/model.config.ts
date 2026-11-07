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
    label: "大肥鱼 · Live2D",
    source: "角色原作：上善无形；DeepSeek 女仆设计：ZipZipPipe；Live2D 建模：氵六青；发布仓库：A8Chann/dsh-pet-live2d",
    licenseNote: "模型素材采用 CC BY-NC-SA 4.0：仅限非商业使用，改编素材须以相同许可共享；用于商业产品前须另行取得各权利人授权。完整署名见本机模型目录的 LICENSE。",
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
