/**
 * 后端发给界面的文案（错误提示、状态说明等）的中英两份。不引第三方库。
 *
 * 语言来自前端每个请求带的 `x-wp-lang` 头：请求处理期间用 AsyncLocalStorage 记住，
 * 深处的服务函数直接 `msg()` 就能拿到对的那份，不用一层层传参。
 * 后台任务（不在请求里）用最近一次请求的语言；进程刚起、还没有请求时按中文。
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

const store = new AsyncLocalStorage<Lang>();
let lastSeen: Lang = "zh";

export function parseLang(value: unknown): Lang | null {
  return value === "en" || value === "zh" ? value : null;
}

/** 请求里带的语言；没带（老客户端、curl）返回 null。 */
export function requestLang(request: IncomingMessage): Lang | null {
  return parseLang(request.headers[LANG_HEADER]);
}

/** 在这次请求的语言下跑完处理函数；同时记成「最近一次」给后台任务用。 */
export function runWithLang<T>(language: Lang | null, fn: () => T): T {
  if (language) lastSeen = language;
  return store.run(language ?? lastSeen, fn);
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
