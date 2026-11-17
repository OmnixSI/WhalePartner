import { useSyncExternalStore } from "react";
import { m } from "./i18n";
import { DEFAULT_MODEL_BY_CHARACTER, defaultModelFor, type AvatarModel, type CharacterId } from "./avatar/model.config";

export type { CharacterId } from "./avatar/model.config";

export interface Character {
  id: CharacterId;
  name: string;
  latin: string;
  tagline: string;
  /** 一句话简介：设置页、选角色时用，平实口吻。 */
  intro: string;
  greeting: string;
  /** 当前已有资源的默认形象；没有可用模型时使用 CharacterMark 默认形象。 */
  modelId: string | null;
  /** 粉丝二创的演示角色；鲸汐是我们自己的原创设定。 */
  fan: boolean;
}

/** 角色清单。后端的人格在 apps/api/src/persona/characters/，id 要对上。 */
export const CHARACTERS: readonly Character[] = [
  {
    id: "deepseek",
    name: m.characters.deepseek.name,
    latin: "DeepSeek · whale girl",
    tagline: m.characters.deepseek.tagline,
    intro: m.characters.deepseek.intro,
    greeting: m.characters.deepseek.greeting,
    modelId: DEFAULT_MODEL_BY_CHARACTER.deepseek,
    fan: true,
  },
  {
    id: "claude",
    name: m.characters.claude.name,
    latin: "Claude · bookish girl",
    tagline: m.characters.claude.tagline,
    intro: m.characters.claude.intro,
    greeting: m.characters.claude.greeting,
    modelId: DEFAULT_MODEL_BY_CHARACTER.claude,
    fan: true,
  },
  {
    id: "chatgpt",
    name: m.characters.chatgpt.name,
    latin: "ChatGPT · mint girl",
    tagline: m.characters.chatgpt.tagline,
    intro: m.characters.chatgpt.intro,
    greeting: m.characters.chatgpt.greeting,
    modelId: DEFAULT_MODEL_BY_CHARACTER.chatgpt,
    fan: true,
  },
  {
    id: "whale",
    name: m.characters.whale.name,
    latin: "Jingxi · your ocean friend",
    tagline: m.characters.whale.tagline,
    intro: m.characters.whale.intro,
    greeting: m.characters.whale.greeting,
    modelId: DEFAULT_MODEL_BY_CHARACTER.whale,
    fan: false,
  },
];

const CHARACTER_KEY = "wp.character";
const DEFAULT_CHARACTER = CHARACTERS[0];

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notify = () => listeners.forEach((listener) => listener());

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; } // 隐私模式下可能不可用
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* 忽略 */ }
}

const byId = (id: string | null) => CHARACTERS.find((c) => c.id === id);
let character: Character = byId(read(CHARACTER_KEY)) ?? DEFAULT_CHARACTER;

export function applyCharacterTheme() {
  document.documentElement.setAttribute("data-character", character.id);
}

export function setCharacter(id: CharacterId) {
  const next = byId(id);
  if (!next || next.id === character.id) return;
  character = next;
  write(CHARACTER_KEY, next.id);
  applyCharacterTheme();
  notify();
}

export const useCharacter = () => useSyncExternalStore(subscribe, () => character);

export function useModel(): AvatarModel | null {
  const current = useCharacter();
  return defaultModelFor(current.id, current.modelId);
}
