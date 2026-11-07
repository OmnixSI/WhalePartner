import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { SurfError } from "./errors.ts";
import type { WebPageText } from "./types.ts";

/**
 * 正文提取：HTML → @mozilla/readability（linkedom 当 DOM）→ 干净的段落文本。
 * 先剥掉导航、广告、评论、页脚之类的噪音，再让 Readability 挑主体；
 * Readability 判不出来（目录页、很短的页）时退回到「文字最密的块」。
 * 纯函数，不碰网络，测试直接喂 HTML。
 */

export const MAX_TEXT_CHARS = 8000;
export const MIN_TEXT_CHARS = 200;

const NOISE_SELECTORS = [
  "script", "style", "noscript", "iframe", "svg", "canvas", "form", "nav", "aside", "footer", "header",
  "[role=navigation]", "[role=banner]", "[role=complementary]", "[aria-hidden=true]",
  ".ad", ".ads", ".adv", ".advert", ".advertisement", ".ad-box", ".ad-wrapper", ".adsbygoogle", ".banner", ".sponsor", ".sponsored", ".promo",
  '[class*="advert"]', '[class*="sponsor"]', '[id*="advert"]',
  ".comment", ".comments", ".comment-list", "#comments", "#disqus_thread", ".sidebar", ".share-buttons", ".social-share",
  ".related", ".related-posts", ".recommend", ".recommendations", ".breadcrumb", ".breadcrumbs",
  ".cookie", ".cookie-banner", ".newsletter", ".popup", ".modal", ".subscribe",
].join(",");

/** 清噪音时绝不能删掉承载正文的根节点。 */
function stripNoise(document: Document) {
  for (const node of Array.from(document.querySelectorAll(NOISE_SELECTORS))) {
    const tag = node.tagName;
    if (tag === "HTML" || tag === "BODY" || tag === "MAIN" || tag === "ARTICLE") continue;
    if (node.querySelector("article, main")) continue;
    node.remove();
  }
}

export interface ExtractedArticle {
  title: string;
  text: string;
  siteName: string;
  imageUrl?: string;
  /** 抽取走的哪条路：readability 或 densest（兜底）。 */
  method: "readability" | "densest";
}

const BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TR", "BR"]);

/** 把一段 HTML 片段压成段落文本（块级元素之间换行，空白折叠）。 */
export function htmlToParagraphs(html: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    const line = current.replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    current = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      current += (node as Text).data;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const block = BLOCKS.has(element.tagName);
    if (block) flush();
    for (const child of Array.from(element.childNodes)) walk(child);
    if (block) flush();
  };
  walk(document.body);
  flush();
  return lines.join("\n");
}

export function cleanText(text: string, max = MAX_TEXT_CHARS): string {
  const compact = text
    .replace(/[ \t\f\v 　]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return compact.length > max ? compact.slice(0, max) : compact;
}

function absolute(base: string, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

/** 最像正文的块：文字多、链接占比低。 */
function densestBlockText(document: Document): string {
  let best = 0;
  let bestText = "";
  for (const node of Array.from(document.querySelectorAll("article, main, [role=main], section, div"))) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length < MIN_TEXT_CHARS) continue;
    const linkChars = Array.from(node.querySelectorAll("a")).reduce((sum, a) => sum + (a.textContent?.length ?? 0), 0);
    const density = 1 - Math.min(0.95, linkChars / Math.max(1, text.length));
    // 越小的块越精确，所以不单看长度：长度开方，密度平方。
    const score = Math.sqrt(text.length) * density * density;
    if (score > best) {
      best = score;
      bestText = htmlToParagraphs((node as Element).innerHTML ?? text);
    }
  }
  return bestText;
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html);
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute("content")?.trim() ?? "";
  const ogImage = meta('meta[property="og:image"]') || meta('meta[name="og:image"]') || meta('meta[name="twitter:image"]');
  const ogSite = meta('meta[property="og:site_name"]');
  const ogTitle = meta('meta[property="og:title"]');
  const docTitle = (document.title ?? "").trim();

  // 先量一下有哪些大图，失败退而求其次拿第一张像样的 img。
  const fallbackImage = Array.from(document.querySelectorAll("img"))
    .map((img) => ({ src: img.getAttribute("src") ?? "", width: Number(img.getAttribute("width") ?? 0) }))
    .find((item) => item.src && !item.src.startsWith("data:") && (item.width === 0 || item.width >= 300))?.src;

  stripNoise(document as unknown as Document);

  let text = "";
  let title = ogTitle || docTitle;
  let method: ExtractedArticle["method"] = "readability";
  try {
    const parsed = new Readability(document as unknown as Document, { charThreshold: 120, keepClasses: false }).parse();
    if (parsed?.content) {
      text = htmlToParagraphs(parsed.content);
      if (parsed.title) title = parsed.title;
    }
  } catch {
    text = "";
  }
  if (text.length < MIN_TEXT_CHARS) {
    // Readability 会改写 DOM，兜底用重新解析的干净副本。
    const { document: again } = parseHTML(html);
    stripNoise(again as unknown as Document);
    const dense = densestBlockText(again as unknown as Document);
    if (dense.length > text.length) {
      text = dense;
      method = "densest";
    }
  }

  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  return {
    title: title.replace(/\s+/g, " ").trim().slice(0, 200) || host,
    text: cleanText(text),
    siteName: ogSite || host,
    imageUrl: absolute(url, ogImage) ?? absolute(url, fallbackImage),
    method,
  };
}

/** 抽取结果的质量闸：太短、几乎全是链接词的页面当作失败。 */
export function assertReadable(article: ExtractedArticle): void {
  if (article.text.length < MIN_TEXT_CHARS) throw new SurfError("content", "网页里没有读到足够的文字。");
  const lines = article.text.split("\n");
  const shortLines = lines.filter((line) => line.length < 12).length;
  if (lines.length >= 20 && shortLines / lines.length > 0.8) throw new SurfError("content", "网页更像一个目录，没有正文。");
}

/**
 * 内容指纹：取正文里最长的三个自然段（去标点空白、统一大小写、去重）一起哈希。
 * 转载、换链接、换标题、加了署名/页脚/推荐语的同一篇，变的都是短行，最长的几段不变；
 * 没有分段的文字退回到取开头 400 字。
 */
export function contentFingerprint(text: string): string {
  const norm = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const paragraphs = [...new Set(text.split("\n").map(norm).filter((line) => line.length >= 20))];
  let basis: string;
  if (paragraphs.length > 0) {
    basis = paragraphs
      .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
      .slice(0, 3)
      .sort()
      .join("|");
  } else {
    basis = norm(text).slice(0, 400);
  }
  if (basis.length < 30) return "";
  return createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

export function toWebPage(url: string, article: ExtractedArticle): WebPageText {
  return { url, title: article.title, text: article.text, siteName: article.siteName, imageUrl: article.imageUrl };
}
