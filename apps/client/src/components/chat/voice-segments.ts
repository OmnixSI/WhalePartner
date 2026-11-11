export interface SpeechSegment {
  text: string;
  turnId: string;
  segmentIndex: number;
  emotion: string;
  characterId: string;
}

/** 服务端 `/api/voice/tts/stream` 一次最多收的字数（按 JS 字符串长度算，和服务端的检查一致）。 */
export const MAX_SPEECH_CHARS = 1200;

/** 句末：标点后面紧跟的收尾引号、括号也算这一句的。 */
const SENTENCE_END = /[。！？!?；;…\n]+[”’"'」』）)】》]*/gu;
/** 一句话本身就超长时，退而在这些停顿处断开。 */
const SOFT_BREAK = /[，,、：:\s]+/gu;

function cutLongSentence(sentence: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = sentence.trim();
  while (rest.length > max) {
    let cut = 0;
    for (const match of rest.slice(0, max).matchAll(SOFT_BREAK)) cut = match.index + match[0].length;
    if (cut < max / 2) {
      // 前半段之后找不到停顿：在上限处硬切，但别把一个 emoji（代理对）劈成两半。
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff && cut > 1) cut -= 1;
    }
    const piece = rest.slice(0, cut).trim();
    if (piece) pieces.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * 一轮回复要合成的文字：不超过上限就整段一次（和原来一样）；
 * 超过上限才按句切成几段，每段不超过 `max` 字，依次合成播放。
 */
export function splitSpeechText(text: string, max = MAX_SPEECH_CHARS): string[] {
  const content = text.trim();
  if (!content) return [];
  if (content.length <= max) return [content];
  const sentences: string[] = [];
  let start = 0;
  for (const match of content.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    sentences.push(content.slice(start, end));
    start = end;
  }
  if (start < content.length) sentences.push(content.slice(start));
  const segments: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length <= max) {
      current += sentence;
      continue;
    }
    if (current.trim()) segments.push(current.trim());
    current = "";
    if (sentence.length <= max) current = sentence;
    else segments.push(...cutLongSentence(sentence, max));
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

export function createSpeechSegment(
  text: string,
  turnId: string,
  segmentIndex: number,
  emotion: string,
  characterId: string,
): SpeechSegment | null {
  const content = text.trim();
  return content ? { text: content, turnId, segmentIndex, emotion, characterId } : null;
}
