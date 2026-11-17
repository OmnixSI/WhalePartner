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

/** 中文是源语言：键的结构以这里为准，英文那份必须一模一样。 */
export const zh = { app, common, settings, setup, chat, diary, memory, surf, characters, cards };
