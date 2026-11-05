export const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "relaxed"] as const;
export type Emotion = (typeof EMOTIONS)[number];

const TAG = /^\[emotion:([a-z]+)\]/;
const MAX_TAG_LENGTH = "[emotion:surprised]".length;

function isEmotion(value: string): value is Emotion {
  return (EMOTIONS as readonly string[]).includes(value);
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
      const open = input.indexOf("[");
      if (open === -1) {
        text += input;
        break;
      }
      text += input.slice(0, open);
      input = input.slice(open);

      const match = TAG.exec(input);
      if (match) {
        if (isEmotion(match[1])) emotions.push(match[1]);
        input = input.slice(match[0].length);
        continue;
      }
      // 还没收全：可能是被截断的标签，等下一个增量。
      const prefix = "[emotion:";
      const couldBeTag = input.length <= MAX_TAG_LENGTH && (prefix.startsWith(input) || /^\[emotion:[a-z]*$/.test(input));
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
