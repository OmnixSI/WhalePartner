/**
 * 回复「有节奏地出现」：把她的话按句拆成 1–3 条，条与条之间停顿 400–900ms（像对方在打字）。
 * 只对「刚刚流出来的」回复生效；翻历史、切回聊天页时一次摆全，不重放。设置里可关闭。
 */
import { useEffect, useRef, useState } from "react";
import { splitReply, typingGap } from "../../lib/reply";

export interface Paced {
  parts: string[];
  /** 已经亮出来几条。 */
  revealed: number;
  /** 下一条还在「打字」。 */
  typing: boolean;
}

export function usePacedReply(opts: { key: string | undefined; text: string; fresh: boolean; enabled: boolean }): Paced {
  const { key, text, fresh, enabled } = opts;
  const parts = enabled ? splitReply(text) : text ? [text] : [];
  const [revealed, setRevealed] = useState(parts.length);
  const lastKey = useRef(key);
  const freshRef = useRef(fresh);

  // 换了一条回复：新流出来的从第 1 条开始，历史里的一次摆全。
  if (lastKey.current !== key) {
    lastKey.current = key;
    freshRef.current = fresh;
    if (revealed !== (fresh ? Math.min(1, parts.length) : parts.length)) setRevealed(fresh ? Math.min(1, parts.length) : parts.length);
  }
  if (fresh) freshRef.current = true;

  useEffect(() => {
    if (!enabled || !freshRef.current) {
      if (revealed !== parts.length) setRevealed(parts.length);
      return;
    }
    if (revealed === 0 && parts.length > 0) { setRevealed(1); return; }
    if (parts.length > revealed && revealed > 0) {
      const timer = setTimeout(() => setRevealed((n) => Math.min(parts.length, n + 1)), typingGap(parts[revealed - 1]));
      return () => clearTimeout(timer);
    }
  }, [enabled, parts.length, revealed, parts]);

  return { parts, revealed: Math.min(revealed, parts.length), typing: enabled && parts.length > revealed };
}
