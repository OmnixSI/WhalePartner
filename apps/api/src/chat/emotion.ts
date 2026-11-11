export const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "relaxed"] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** 放宽：容忍空格、大小写、全角冒号与全角/中文括号。 */
const TAG = /^[\[［【]\s*emotion\s*[:：]\s*([a-z]+)\s*[\]］】]/i;
/** 还没收全的标签开头（`[`、`[emo`、`[emotion :`、`[emotion: ha`），要先缓冲。 */
const TAG_PARTIAL = /^[\[［【]\s*(?:(?:e(?:m(?:o(?:t(?:i(?:o(?:n)?)?)?)?)?)?)?|emotion\s*(?:[:：]\s*[a-z]*\s*)?)$/i;
/** 全局扫描用：标签不只在句首，模型有时候会插在中间或结尾。 */
const TAG_ANY = /[\[［【]\s*emotion\s*[:：]\s*([a-z]+)\s*[\]］】]/gi;
const MAX_TAG_LENGTH = 32;

export function isEmotion(value: string): value is Emotion {
  return (EMOTIONS as readonly string[]).includes(value);
}

/**
 * 一次性剥掉整段文本里的情绪标签，返回干净正文 + 出现过的情绪。
 *
 * 主动分享（`surf/service.ts`）和日记这类「不是流式」的路径必须走这里：
 * 0.2.4 之前它们直接把模型原文塞进消息表，于是界面上出现
 * `[emotion:relaxed] 今天翻到一个…`——标签成了正文。
 */
export function splitEmotionTags(text: string): { text: string; emotions: Emotion[] } {
  const emotions: Emotion[] = [];
  for (const match of text.matchAll(TAG_ANY)) {
    if (isEmotion((match[1] ?? "").toLowerCase())) emotions.push((match[1] as string).toLowerCase() as Emotion);
  }
  const clean = text.replace(TAG_ANY, "").replace(/^\s+/, "");
  return { text: clean, emotions };
}

/** 只要干净正文。 */
export function stripEmotionTags(text: string): string {
  return splitEmotionTags(text).text;
}

/**
 * 流式剥离回复里的 `[emotion:happy]` 标签。标签可能被拆在两个增量之间，
 * 所以遇到可能是标签开头的 “[” 先缓冲，直到能确定它是不是标签。
 */
export class EmotionFilter {
  #pending = "";

  feed(chunk: string): { text: string; emotions: Emotion[] } {
    let input = this.#pending + chunk;
    this.#pending = "";
    let text = "";
    const emotions: Emotion[] = [];

    while (input.length > 0) {
      const open = input.search(/[\[［【]/);
      if (open === -1) {
        text += input;
        break;
      }
      text += input.slice(0, open);
      input = input.slice(open);

      const match = TAG.exec(input);
      if (match) {
        if (isEmotion(match[1].toLowerCase())) emotions.push(match[1].toLowerCase() as Emotion);
        input = input.slice(match[0].length);
        continue;
      }
      // 还没收全：可能是被截断的标签，等下一个增量。
      const couldBeTag = input.length <= MAX_TAG_LENGTH && TAG_PARTIAL.test(input);
      if (couldBeTag) {
        this.#pending = input;
        break;
      }
      text += input[0];
      input = input.slice(1);
    }
    return { text, emotions };
  }

  /** 流结束时把还没判定的缓冲当作普通文字吐出。 */
  flush(): string {
    const rest = this.#pending;
    this.#pending = "";
    return rest;
  }
}
