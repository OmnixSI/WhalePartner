import manifest from "../../models.manifest.json";

/** 角色模型清单来自 models.manifest.json（fetch-model 脚本读同一份）：新增模型只改清单。 */
export interface AvatarModel {
  id: string;
  url: string;
  label: string;
  source: string;
  licenseNote: string;
}

export const AVATAR_MODELS: readonly AvatarModel[] = manifest.models.map((m) => ({
  id: m.id,
  url: `/models/${m.file}`,
  label: m.label,
  source: m.source,
  licenseNote: m.licenseNote,
}));

/** 目前用的都是别人做好的现成模型，授权没有核对，只作内部展示；对外发布前要换成有授权的角色。 */
export const AVATAR_IS_PLACEHOLDER = true;

export type AvatarEmotion = "neutral" | "happy" | "sad" | "angry" | "surprised" | "relaxed";
