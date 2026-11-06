import type { ChatProvider } from "../llm/types.ts";
import type { CharacterId } from "../persona/persona.ts";
import { buildSystemPrompt } from "../persona/persona.ts";
import { containsBlocked } from "./blocklist.ts";
import { extractJson } from "./picker.ts";
import type { ItemSummary, VideoCandidate, WebResult } from "./types.ts";

/** 一次短模型调用的包装：把流拼成整段文字，超时就放弃。 */
export async function ask(
  provider: ChatProvider,
  system: string,
  user: string,
  options: { temperature: number; maxTokens: number; signal?: AbortSignal },
): Promise<string> {
  let raw = "";
  for await (const delta of provider.stream(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: options.temperature, maxTokens: options.maxTokens, signal: options.signal },
  )) {
    if (delta.text) raw += delta.text;
  }
  return raw;
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

/** 总结提示词（§10.6.11）。 */
export function summaryPrompt(input: { kind: "video" | "web"; title: string; sourceSite: string; text: string }): string {
  const kind = input.kind === "video" ? "视频" : "网页";
  return [
    `你刚刚自己看了下面这个${kind}。请只输出一个 JSON：`,
    '{"summary":"<客观摘要，80 到 160 字，写清它讲了什么>","comment":"<你自己的一句话感想，不超过 30 个字，用你平常的口吻，不要加表情符号>","tags":["<至多 3 个短标签，每个不超过 6 字>"],"worth_sharing":<1 到 5 的整数，5 表示非常想讲给对方听>,"safe":<true 或 false，内容是否适合一个温和的陪伴应用展示>}',
    `标题：${input.title}`,
    `来源：${input.sourceSite}`,
    "内容：",
    clip(input.text, 6000),
  ].join("\n");
}

/**
 * 解析总结 JSON。宽容一点：围栏、前后废话、tags 写成字符串都认；
 * 但 summary 为空、safe 为 false 之外的硬伤一律判失败（调用方丢掉这条）。
 */
export function parseItemSummary(raw: string): ItemSummary | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as Record<string, unknown>;
  const summary = typeof body.summary === "string" ? body.summary.replace(/\s+/g, " ").trim() : "";
  if (summary.length < 10) return null;
  const commentRaw = typeof body.comment === "string" ? body.comment.replace(/\s+/g, " ").trim() : "";
  const comment = [...commentRaw].slice(0, 40).join("");
  const tagsRaw = body.tags;
  const tags: string[] = [];
  if (Array.isArray(tagsRaw)) {
    for (const tag of tagsRaw) {
      if (typeof tag !== "string") continue;
      const trimmed = tag.replace(/^#/, "").trim();
      if (!trimmed) continue;
      tags.push([...trimmed].slice(0, 6).join(""));
      if (tags.length === 3) break;
    }
  }
  const scoreRaw = Number(body.worth_sharing);
  const score = Number.isFinite(scoreRaw) ? Math.min(5, Math.max(1, Math.round(scoreRaw))) : 3;
  const safe = body.safe === undefined ? true : body.safe !== false;
  return { summary: clip(summary, 400), comment, tags, worthSharing: score, safe };
}

/** 总结一条，失败重试一次；两次都失败返回 null（这条丢弃，不入库）。 */
export async function summarizeItem(
  provider: ChatProvider,
  character: CharacterId,
  input: { kind: "video" | "web"; title: string; sourceSite: string; text: string },
  blocked: readonly string[],
  signal?: AbortSignal,
): Promise<ItemSummary | null> {
  const system = buildSystemPrompt({}, character);
  const user = summaryPrompt(input);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await ask(provider, system, user, { temperature: 0.5, maxTokens: 400, signal });
      const summary = parseItemSummary(raw);
      if (!summary) continue;
      // 总结本身带出屏蔽词也算不安全（§10.6.8 C）。
      if (containsBlocked(`${summary.summary} ${summary.comment}`, blocked)) return null;
      if (!summary.safe) return null;
      return summary;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return null;
}

/** 让模型从候选里挑一个视频（§10.6.8 A.3）。 */
export async function pickVideo(
  provider: ChatProvider,
  character: CharacterId,
  candidates: readonly VideoCandidate[],
  topics: readonly string[],
  signal?: AbortSignal,
): Promise<{ index: number; reason: string }> {
  const list = candidates
    .map((item, index) => `${index}. 标题：${item.title}\n   UP 主：${item.author}｜时长：${Math.round(item.durationSeconds / 60)} 分｜播放：${item.play}\n   简介：${clip(item.description, 60)}`)
    .join("\n");
  const user = [
    "你正在自己刷 B 站。下面是搜到的几个视频。",
    `你最近想看的：${topics.join("、")}`,
    list,
    '请只输出 JSON：{"index": <想看的那一个的编号>, "reason": "<一句话，用你平常的口吻说为什么想看>"}',
  ].join("\n\n");
  try {
    const raw = await ask(provider, buildSystemPrompt({}, character), user, { temperature: 0.6, maxTokens: 120, signal });
    const parsed = extractJson(raw);
    const index = Number((parsed as { index?: unknown } | null)?.index);
    const reason = typeof (parsed as { reason?: unknown } | null)?.reason === "string" ? String((parsed as { reason: string }).reason) : "";
    if (Number.isInteger(index) && index >= 0 && index < candidates.length) return { index, reason: clip(reason, 60) };
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return { index: 0, reason: "" };
}

/** 让模型从网页结果里挑 ≤3 个（§10.6.8 B.2）。 */
export async function pickWebs(
  provider: ChatProvider,
  character: CharacterId,
  results: readonly WebResult[],
  topics: readonly string[],
  limit: number,
  signal?: AbortSignal,
): Promise<number[]> {
  const list = results
    .map((item, index) => `${index}. ${item.title}\n   地址：${item.url}\n   摘要：${clip(item.snippet, 80)}`)
    .join("\n");
  const user = [
    "你正在自己上网冲浪。下面是搜到的几个页面。",
    `你最近想看的：${topics.join("、")}`,
    list,
    `请挑不超过 ${Math.min(3, limit)} 个最想看的，只输出 JSON：{"picks":[{"index":0,"reason":"…"}]}`,
  ].join("\n\n");
  try {
    const raw = await ask(provider, buildSystemPrompt({}, character), user, { temperature: 0.6, maxTokens: 180, signal });
    const parsed = extractJson(raw);
    const picks = (parsed as { picks?: unknown } | null)?.picks;
    const out: number[] = [];
    if (Array.isArray(picks)) {
      for (const item of picks) {
        const index = Number((item as { index?: unknown } | null)?.index);
        if (Number.isInteger(index) && index >= 0 && index < results.length && !out.includes(index)) out.push(index);
        if (out.length >= Math.min(3, limit)) break;
      }
    }
    if (out.length === 0 && results.length > 0) out.push(0);
    return out;
  } catch (error) {
    if (signal?.aborted) throw error;
    return results.length > 0 ? [0] : [];
  }
}

/** 从最近聊天里提炼 ≤4 个话题关键词（§10.6.3-3），失败返回空。 */
export async function extractRecentTopics(
  provider: ChatProvider,
  messages: readonly string[],
  facts: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (messages.length === 0 && facts.length === 0) return [];
  const user = [
    "下面是用户最近的几句话，和他提过的一些事。",
    messages.length > 0 ? `<messages>\n${messages.slice(0, 40).map((line) => clip(line, 120)).join("\n")}\n</messages>` : "",
    facts.length > 0 ? `<facts>\n${facts.slice(0, 10).map((line) => clip(line, 120)).join("\n")}\n</facts>` : "",
    '请提炼不超过 4 个他最近关心的短话题关键词（每个 2 到 6 个字），只输出 JSON：{"topics":["…"]}',
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const raw = await ask(provider, "你是整理话题的助手。只输出 JSON，不要解释。", user, {
      temperature: 0.4,
      maxTokens: 150,
      signal,
    });
    const parsed = extractJson(raw);
    const topics = (parsed as { topics?: unknown } | null)?.topics;
    const out: string[] = [];
    if (Array.isArray(topics)) {
      for (const topic of topics) {
        if (typeof topic !== "string") continue;
        const trimmed = topic.trim().replace(/^#/, "");
        if (trimmed && [...trimmed].length <= 12 && !out.includes(trimmed)) out.push(trimmed);
        if (out.length === 4) break;
      }
    }
    return out;
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
}

/** 分享话术（§10.6.6）。失败返回空串，调用方放弃这次分享。 */
export async function writeShareLine(
  provider: ChatProvider,
  character: CharacterId,
  item: { title: string; sourceSite: string; summary: string },
  signal?: AbortSignal,
): Promise<string> {
  const user = [
    "你刚才自己去逛，看到了一样东西，想顺口讲给对方听。",
    `标题：${item.title}`,
    `来源：${item.sourceSite}`,
    `你的笔记：${clip(item.summary, 600)}`,
    "请用你平常说话的口吻，说 1 到 3 句话，像随口分享，不要催对方点开，不要说“链接在下面”，不要加表情符号。以“我今天看到…”或类似自然的开头皆可。",
  ].join("\n");
  try {
    const raw = await ask(provider, buildSystemPrompt({}, character), user, { temperature: 0.8, maxTokens: 160, signal });
    return raw.replace(/\s+/g, " ").trim().slice(0, 200);
  } catch (error) {
    if (signal?.aborted) throw error;
    return "";
  }
}
