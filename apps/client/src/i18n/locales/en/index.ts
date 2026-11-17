import { app } from "./app.ts";
import { common } from "./common.ts";
import { settings } from "./settings.ts";
import { setup } from "./setup.ts";
import { chat } from "./chat.ts";
import { diary } from "./diary.ts";
import { memory } from "./memory.ts";
import { surf } from "./surf.ts";
import { characters } from "./characters.ts";
import { cards } from "./cards.ts";
import type { zh } from "../zh/index.ts";

export const en: typeof zh = { app, common, settings, setup, chat, diary, memory, surf, characters, cards };
