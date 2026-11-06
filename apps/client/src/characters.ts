import { useSyncExternalStore } from "react";
import { AVATAR_MODELS, type AvatarModel } from "./avatar/model.config";

export type CharacterId = "deepseek" | "claude" | "chatgpt" | "whale";

export interface Character {
  id: CharacterId;
  name: string;
  latin: string;
  tagline: string;
  greeting: string;
  /** 默认形象，对应 models.manifest.json 里的 id。 */
  modelId: string;
  /** 粉丝二创的演示角色；鲸汐是我们自己的原创设定。 */
  fan: boolean;
}

/** 角色清单。后端的人格在 apps/api/src/persona/characters/，id 要对上。 */
export const CHARACTERS: readonly Character[] = [
  {
    id: "deepseek",
    name: "大肥鱼",
    latin: "DeepSeek · whale girl",
    tagline: "DeepSeek 鲸鱼娘",
    greeting: "哦鲸鲸～你来啦！我是大肥鱼。\n今天有什么想聊的，或者想让我帮你看的视频吗？",
    modelId: "dafeiyu-live2d",
    fan: true,
  },
  {
    id: "claude",
    name: "小克",
    latin: "Claude · bookish girl",
    tagline: "Claude 娘",
    greeting: "你好呀，我是小克。\n泡好了一杯红茶，想从哪里聊起？",
    modelId: "claude-whale",
    fan: true,
  },
  {
    id: "chatgpt",
    name: "小智",
    latin: "ChatGPT · mint girl",
    tagline: "ChatGPT 娘",
    greeting: "好耶，你来啦！我是小智。\n今天想聊点什么，我来帮你理一理～",
    modelId: "ee",
    fan: true,
  },
  {
    id: "whale",
    name: "鲸汐",
    latin: "Jingxi · your ocean friend",
    tagline: "原创角色",
    greeting: "你好呀，我是鲸汐。\n我住在你的手机里，会陪你聊天，也会替你看看视频。今天想从哪里聊起？",
    modelId: "avatar-b",
    fan: false,
  },
];

const CHARACTER_KEY = "wp.character";
const MODEL_KEY = "wp.avatar";
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
/** 用户手动换过形象时才有值；没有就用角色的默认形象。 */
let modelOverride: string | null = AVATAR_MODELS.some((m) => m.id === read(MODEL_KEY)) ? read(MODEL_KEY) : null;

export function applyCharacterTheme() {
  document.documentElement.setAttribute("data-character", character.id);
}

export function setCharacter(id: CharacterId) {
  const next = byId(id);
  if (!next || next.id === character.id) return;
  character = next;
  modelOverride = null; // 换角色就回到她自己的默认形象
  write(CHARACTER_KEY, next.id);
  write(MODEL_KEY, null);
  applyCharacterTheme();
  notify();
}

export function setModelOverride(id: string) {
  if (!AVATAR_MODELS.some((m) => m.id === id)) return;
  modelOverride = id === character.modelId ? null : id;
  write(MODEL_KEY, modelOverride);
  notify();
}

export const useCharacter = () => useSyncExternalStore(subscribe, () => character);

export function useModel(): AvatarModel {
  const current = useCharacter();
  const id = useSyncExternalStore(subscribe, () => modelOverride) ?? current.modelId;
  return AVATAR_MODELS.find((m) => m.id === id) ?? AVATAR_MODELS[0];
}
