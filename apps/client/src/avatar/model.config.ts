/** 角色模型的唯一配置点。换原创模型只改这里和 scripts/fetch-model.mjs。 */
export const AVATAR_MODEL = {
  url: "/models/demo.vrm",
  label: "演示模型 · VRM1 Constraint Twist Sample",
  author: "pixiv Inc.",
  license: "VRM Public License 1.0",
  licenseUrl: "https://vrm.dev/licenses/1.0/",
  /** true 表示不是鲸汐的正式形象，界面会如实标注。 */
  placeholder: true,
} as const;

export type AvatarEmotion = "neutral" | "happy" | "sad" | "surprised" | "relaxed";
