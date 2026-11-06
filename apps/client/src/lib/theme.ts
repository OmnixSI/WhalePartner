// 把 auto 解析成 light/dark：CSS 只需要一份暗色（规范 §4.8）。
export type ThemeChoice = "auto" | "light" | "dark";
const KEY = "wp.theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");

export const readTheme = (): ThemeChoice => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* 隐私模式下 localStorage 可能不可用 */ }
  return "auto";
};

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  const resolved = choice === "auto" ? (mq.matches ? "dark" : "light") : choice;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-pref", choice);
  try {
    choice === "auto" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice);
  } catch { /* 忽略 */ }
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#0F1C2A" : "#F6EFE2");
}

mq.addEventListener("change", () => { if (readTheme() === "auto") applyTheme("auto"); });
