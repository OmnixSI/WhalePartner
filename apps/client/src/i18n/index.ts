/**
 * 界面语言（中文 / English）。不引第三方库：两份文案是普通 TS 对象，英文那份的类型取自中文那份，
 * 少键、多键、参数对不上都会在 tsc 里报错；`scripts/i18n-check.mjs` 再做一次运行时的键对齐检查。
 *
 * 语言在启动时选定一次，之后整页都读同一份 `m`。切换语言（设置页，或「跟随系统」时系统语言变了）
 * 直接重新载入窗口：模块顶层的常量、懒加载页面、Tauri 托盘都按新语言重新来一遍，不会半中半英。
 */
import { zh } from "./locales/zh/index.ts";
import { en } from "./locales/en/index.ts";

export type Lang = "zh" | "en";
export type LangPref = "system" | Lang;
export type Messages = typeof zh;

const KEY = "wp.lang";

export function readLangPref(): LangPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "zh" || v === "en") return v;
  } catch { /* 隐私模式或非浏览器环境 */ }
  return "system";
}

/** 系统语言是中文（任何 zh-*）就用中文，其他一律英文。非浏览器环境（node:test）按中文。 */
export function systemLang(): Lang {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "zh";
  const first = navigator.languages?.[0] ?? navigator.language ?? "";
  return /^zh\b/i.test(first) ? "zh" : "en";
}

export function resolveLang(pref: LangPref): Lang {
  return pref === "system" ? systemLang() : pref;
}

/** 本次启动用的语言；整个会话不变，换语言走 reload。 */
export const lang: Lang = resolveLang(readLangPref());
export const m: Messages = lang === "en" ? en : zh;
/** 给 Intl / toLocale* 用的区域标识。 */
export const locale = lang === "en" ? "en-US" : "zh-CN";

/** 存下选择；实际语言变了就重新载入。返回是否会重载。 */
export function setLangPref(pref: LangPref): boolean {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* 隐私模式：只影响这一次 */ }
  const next = resolveLang(pref);
  void syncShellLang(next);
  if (next === lang) return false;
  window.location.reload();
  return true;
}

/** 告诉桌面壳当前语言（托盘菜单、启动失败弹窗用）。浏览器里什么都不做。 */
async function syncShellLang(value: Lang) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_ui_lang", { lang: value });
  } catch { /* 旧壳没有这个命令：托盘保持原样 */ }
}

/** 启动时调用一次：html lang、标题、桌面壳语言；「跟随系统」时系统语言变了就跟着重载。 */
export function installLang() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.title = m.app.documentTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", m.app.description);
  void syncShellLang(lang);
  window.addEventListener("languagechange", () => {
    if (readLangPref() === "system" && systemLang() !== lang) window.location.reload();
  });
}

/** 后端请求带上界面语言，服务端据此选错误提示等文案。 */
export const LANG_HEADER = "x-wp-lang";
