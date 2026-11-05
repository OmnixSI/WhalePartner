/**
 * 记忆的“清晰度”：思路借自 Mieksido/surfcore（MIT）的衰减记忆卡。
 * 全部记忆都留在 mem0 里（相当于它的“全量卡”，记忆页能看到、能删）；
 * 放进提示词的是“衰减视图”：越久远越模糊，太久的不再主动带出来，重要的不会被忘掉。
 * 评分是纯函数、不调用模型，结果稳定、可解释、可单测。
 */
export type Clarity = "vivid" | "clear" | "fuzzy" | "trace";

const DAY_MS = 86_400_000;
const STRONG = /喜欢|想念|难过|委屈|哭|抱抱|对不起|谢谢|陪|永远|害怕|开心|生气/g;
const PROMISE = /答应|约定|说好|以后|下次|不要忘|发誓|记得/;
const FIRST = /第一次|初次|最早|刚认识|纪念日|生日/;
const CONFLICT = /吵架|道歉|和好|误会|冷战/;
const IDENTITY = /用户(叫|的名字|养|住在|在.{0,6}(工作|上学|读书)|的生日)|名字叫|我叫/;
const SELF = /我喜欢|我是|我的|用户喜欢|用户的/;

export function scoreImportance(text: string): number {
  let score = 8;
  score += Math.min(24, (text.match(STRONG)?.length ?? 0) * 8);
  if (PROMISE.test(text)) score += 16;
  if (FIRST.test(text)) score += 30;
  if (CONFLICT.test(text)) score += 14;
  if (IDENTITY.test(text)) score += 55;
  if (SELF.test(text)) score += 5;
  if (text.trim().length < 6 && !IDENTITY.test(text)) score -= 12;
  return Math.max(1, Math.min(100, score));
}

/** 重要度达到这个值的记忆至少保持“清楚”，不会被忘掉。 */
export const PINNED_IMPORTANCE = 60;

export function clarityOf(entry: { text: string; createdAt?: string }, now = new Date()): Clarity {
  const created = entry.createdAt ? Date.parse(entry.createdAt) : NaN;
  const ageDays = Number.isNaN(created) ? 0 : Math.max(0, (now.getTime() - created) / DAY_MS);
  const raw: Clarity = ageDays < 3 ? "vivid" : ageDays < 14 ? "clear" : ageDays < 45 ? "fuzzy" : "trace";
  if ((raw === "fuzzy" || raw === "trace") && scoreImportance(entry.text) >= PINNED_IMPORTANCE) return "clear";
  return raw;
}

/** 把记忆整理成放进提示词的文字：清楚的原样，模糊的缩短并注明，太久的不带。 */
export function decayForPrompt(entries: Array<{ text: string; createdAt?: string }>, now = new Date()): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const clarity = clarityOf(entry, now);
    if (clarity === "trace") continue;
    if (clarity === "fuzzy") {
      const flat = entry.text.replace(/\s+/g, " ").trim();
      out.push(flat.length > 30 ? `${flat.slice(0, 30)}…（记不太清了）` : `${flat}（记不太清了）`);
    } else {
      out.push(entry.text);
    }
  }
  return out;
}
