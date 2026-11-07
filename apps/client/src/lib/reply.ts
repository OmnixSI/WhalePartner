/** 把一条回复按句拆成 1–3 条「气泡」（纯函数，无依赖，可单测）。拆分对流式前缀稳定：已确定的边界不会因后面追加文字而移动。 */

const MIN_BUBBLE = 18;
const MAX_BUBBLES = 3;
const SENTENCE = /[^。！？!?…~～\n]+[。！？!?…~～]*[”’」』）)]*\n*|\n+/gu;

export function splitReply(text: string): string[] {
  const clean = text.replace(/\r/g, "");
  if (!clean.trim()) return clean ? [clean] : [];
  const sentences = clean.match(SENTENCE) ?? [clean];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    current += sentence;
    const ended = /[。！？!?…~～”’」』）)\n]\s*$/u.test(sentence);
    if (ended && parts.length < MAX_BUBBLES - 1 && current.trim().length >= MIN_BUBBLE) {
      parts.push(current);
      current = "";
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** 两条气泡之间「她在打字」的停顿：按上一条的字数估，400–900ms。 */
export function typingGap(previous: string): number {
  return Math.min(900, Math.max(400, 300 + previous.trim().length * 22));
}

/** 取出连续文本 [from, to) 对应的 chunk 片段（保留流式分片，用于 ink-in 动画）。 */
export function sliceChunks(chunks: string[], from: number, to: number): string[] {
  const out: string[] = [];
  let offset = 0;
  for (const chunk of chunks) {
    const start = Math.max(from, offset);
    const end = Math.min(to, offset + chunk.length);
    if (end > start) out.push(chunk.slice(start - offset, end - offset));
    offset += chunk.length;
    if (offset >= to) break;
  }
  return out;
}
