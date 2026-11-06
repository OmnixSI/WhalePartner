/**
 * 视口与键盘（规范 §7.1.3）。
 *
 * `visualViewport` 是唯一能知道「键盘弹起来了」的接口：`innerHeight - vv.height > 120`
 * 就认为是键盘（浏览器地址栏/工具栏的高度差远小于 120）。真时写 `--vvh` 与 `data-kb="on"`，
 * 由 chat.css 把整页高度改成 `var(--vvh)`、把舞台压成贴纸、把 tabbar 收起来。
 * 收起后 `data-kb` 变回 off，CSS 的 280ms 过渡负责弹簧复位。
 */
import { useEffect, useState } from "react";

export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      const kb = window.innerHeight - vv.height > 120;
      root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      root.dataset.kb = kb ? "on" : "off";
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      delete root.dataset.kb;
      root.style.removeProperty("--vvh");
    };
  }, []);
}

/** 媒体查询的 React 版：`useMediaQuery("(min-width: 960px)")`。 */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return match;
}
