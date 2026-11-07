/**
 * 情绪：她说什么话，就该是什么表情，而不是在句子里挂一个 `[emotion:happy]`。
 *
 * - 后端已经会在入库前剥掉标签（`apps/api/src/emotion.ts`），这里再兜一层：
 *   0.2.4 之前存进库的老消息还带着标签，渲染时必须干净。
 * - 情绪的去处是三处，都不是「把标签写在正文里」：角色的脸（Live2D 表情 / VRM blend shape）、
 *   名字牌上的小圆点、读屏时的一句话。
 */
import type { AvatarEmotion } from "../avatar/model.config";

export type { AvatarEmotion };

const TAGS = /\[\s*emotion\s*:\s*([a-z]+)\s*\]/gi;

/** 老数据兜底：把正文里的标签去掉（前端不依赖后端是否已经做好）。 */
export function stripEmotionTags(text: string): string {
  return text.replace(TAGS, "").replace(/^\s+/, "");
}

/** 从一段原文里同时取出干净正文和第一个情绪。 */
export function readEmotion(text: string): { text: string; emotion: AvatarEmotion | null } {
  let first: AvatarEmotion | null = null;
  for (const match of text.matchAll(TAGS)) {
    const value = (match[1] ?? "").toLowerCase();
    if (isEmotion(value)) {
      first ??= value;
      break;
    }
  }
  return { text: stripEmotionTags(text), emotion: first };
}

export function isEmotion(value: string | null | undefined): value is AvatarEmotion {
  return (
    value === "neutral" ||
    value === "happy" ||
    value === "sad" ||
    value === "angry" ||
    value === "surprised" ||
    value === "relaxed"
  );
}

/** 只给读屏和调试看的说法；界面上不印这个字。 */
export const EMOTION_LABEL: Record<AvatarEmotion, string> = {
  neutral: "平静",
  happy: "开心",
  sad: "难过",
  angry: "有点生气",
  surprised: "意外",
  relaxed: "放松",
};
