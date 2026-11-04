/** 角色模型的唯一配置点：新增或替换模型改这里和 scripts/fetch-model.mjs。 */
export interface AvatarModel {
  id: string;
  url: string;
  label: string;
  note: string;
  author: string;
  license: string;
  licenseUrl: string;
}

export const AVATAR_MODELS: readonly AvatarModel[] = [
  {
    id: "avatar-a",
    url: "/models/avatar-a.vrm",
    label: "栗发 · 软绵绵",
    note: "VRoid 官方示例 AvatarSample_A",
    author: "pixiv Inc. / VRoid Project",
    license: "VRoid 示例模型使用条件",
    licenseUrl: "https://vroid.pixiv.help/hc/en-us/articles/4402394424089",
  },
  {
    id: "avatar-b",
    url: "/models/avatar-b.vrm",
    label: "紫发 · 元气系",
    note: "VRoid 官方示例 AvatarSample_B",
    author: "pixiv Inc. / VRoid Project",
    license: "VRoid 示例模型使用条件",
    licenseUrl: "https://vroid.pixiv.help/hc/en-us/articles/4402394424089",
  },
];

export const DEFAULT_MODEL_ID = AVATAR_MODELS[0].id;

/** 目前用的都是别人做好的现成模型，只作内部展示；对外发布前要换成有授权的角色。 */
export const AVATAR_IS_PLACEHOLDER = true;

export type AvatarEmotion = "neutral" | "happy" | "sad" | "surprised" | "relaxed";
