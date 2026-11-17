import { common } from "./en-parts/common.ts";
import { core } from "./en-parts/core.ts";
import { content } from "./en-parts/content.ts";
import type { zh } from "./zh.ts";

export const en: typeof zh = { common, core, content };
