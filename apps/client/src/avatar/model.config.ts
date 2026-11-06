import manifest from "../../models.manifest.json";

export interface AvatarModel {
  id: string;
  url: string;
  label: string;
  source: string;
  licenseNote: string;
  renderer: "vrm" | "live2d";
  internalOnly: boolean;
}

export const AVATAR_MODELS: readonly AvatarModel[] = [
  {
    id: "dafeiyu-live2d",
    url: "/live2d/whale-maid/c_0120.model3.json",
    label: "大肥鱼 · Live2D",
    source: "角色原作：上善无形；DeepSeek 女仆设计：ZipZipPipe；Live2D 建模：氵六青；发布仓库：A8Chann/dsh-pet-live2d",
    licenseNote: "模型素材采用 CC BY-NC-SA 4.0：仅限非商业使用，改编素材须以相同许可共享；用于商业产品前须另行取得各权利人授权。完整署名见本机模型目录的 LICENSE。",
    renderer: "live2d",
    internalOnly: false,
  },
  ...manifest.models.map((m) => ({
    id: m.id,
    url: `/models/${m.file}`,
    label: m.label,
    source: m.source,
    licenseNote: m.licenseNote,
    renderer: "vrm" as const,
    internalOnly: true,
  })),
];

export type AvatarEmotion = "neutral" | "happy" | "sad" | "angry" | "surprised" | "relaxed";
