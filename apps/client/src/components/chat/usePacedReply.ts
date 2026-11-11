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

  // parts 每次渲染都是新数组：effect 只跟条数和上一条的文字走，免得每次重渲染都把计时器重置。
  const count = parts.length;
  const previous = revealed > 0 ? parts[revealed - 1] ?? "" : "";
  useEffect(() => {
    if (!enabled || !freshRef.current) {
      if (revealed !== count) setRevealed(count);
      return;
    }
    if (revealed === 0 && count > 0) { setRevealed(1); return; }
    if (count > revealed && revealed > 0) {
      const timer = setTimeout(() => setRevealed((n) => Math.min(count, n + 1)), typingGap(previous));
      return () => clearTimeout(timer);
    }
  }, [enabled, count, revealed, previous]);

  return { parts, revealed: Math.min(revealed, parts.length), typing: enabled && parts.length > revealed };
}
