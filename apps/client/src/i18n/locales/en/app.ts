import type { app as Zh } from "../zh/app.ts";

export const app: typeof Zh = {
  name: "WhalePartner",
  documentTitle: "WhalePartner",
  description: "WhalePartner: a companion who lives on your device",
  language: {
    group: "Language",
    groupLabel: "Interface language",
    system: "Match system",
    systemHint: "Chinese if your system is in Chinese, otherwise English",
    zh: "简体中文",
    zhHint: "界面用中文",
    en: "English",
    enHint: "Interface in English",
    note: "The window refreshes once after switching. From then on her replies, diary and finds use this language too.",
  },
};
