/**
 * 后端发给界面的文案（错误提示、状态说明等）的中英两份。不引第三方库。
 *
 * 语言来自前端每个请求带的 `x-wp-lang` 头：请求处理期间用 AsyncLocalStorage 记住，
 * 深处的服务函数直接 `msg()` 就能拿到对的那份，不用一层层传参。
 * 后台任务（不在请求里）用最近一次请求的语言；进程刚起、还没有请求时按 WP_UI_LANG，没有就中文。
 *
 * 不翻译的：日志、给模型的提示词和人设（见 docs 里的说明）、关键词表。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import { zh } from "./zh.ts";
import { en } from "./en.ts";

export type Lang = "zh" | "en";
export type Messages = typeof zh;

export const LANG_HEADER = "x-wp-lang";

export function parseLang(value: unknown): Lang | null {
  return value === "en" || value === "zh" ? value : null;
}

const store = new AsyncLocalStorage<Lang>();
/** 桌面壳启动后端时用 WP_UI_LANG 告诉上次的界面语言，后台任务在第一个请求到来前也用对语言。 */
let lastSeen: Lang = parseLang(process.env.WP_UI_LANG) ?? "zh";

/** 请求里带的语言；没带（老客户端、curl）返回 null。 */
export function requestLang(request: IncomingMessage): Lang | null {
  return parseLang(request.headers[LANG_HEADER]);
}

/** 在这次请求的语言下跑完处理函数；同时记成「最近一次」给后台任务用。 */
export function runWithLang<T>(language: Lang | null, fn: () => T): T {
  if (language) lastSeen = language;
  return store.run(language ?? lastSeen, fn);
}

/**
 * 后台任务（定时器到期、队列里排着的活）在真正运行时用最近一次设置或请求带来的语言，
 * 不继承安排它那一刻的请求语言：用户中途切换了语言，到期生成的内容按新语言来。
 * 多台设备语言不同时，也一律用最近一次的。
 */
export function runInBackgroundLang<T>(fn: () => T): T {
  return store.exit(fn);
}

export function currentLang(): Lang {
  return store.getStore() ?? lastSeen;
}

export function msg(language: Lang = currentLang()): Messages {
  return language === "en" ? en : zh;
}

/** 只给测试用：把「最近一次」复位。 */
export function resetLangForTest(language: Lang = "zh") {
  lastSeen = language;
}

/**
 * 给模型的提示词保持中文原文。界面是英文时，在会显示给用户的 AI 输出（视频总结、近况、学到的、日记等）
 * 的提示词末尾追加这一段，让输出改用英文；`detail` 写这处特有的要求（英文篇幅、标题写法等）。
 * 中文界面返回空串，调用处直接拼接，中文提示词与原来逐字相同。必须在用到时调用，不要存成模块常量。
 */
export function outputLanguageNote(detail = ""): string {
  if (currentLang() !== "en") return "";
  const line = "The user's interface is set to English. Write everything the user will read in natural English, even though the instructions above are in Chinese.";
  return `\n\n## Output language\n${detail ? `${line} ${detail}` : line}`;
}
