import { useCallback, useEffect, useRef, useState } from "react";
import { addedBodyCharacters, speechDurationMs } from "./speech";

export function useSpeechAnimation() {
  const [speaking, setSpeaking] = useState(false);
  const text = useRef("");
  const budgetMs = useRef(0);
  const startedAt = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const reset = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    text.current = "";
    budgetMs.current = 0;
    startedAt.current = null;
    setSpeaking(false);
  }, []);

  const append = useCallback((chunk: string) => {
    const next = text.current + chunk;
    const added = addedBodyCharacters(text.current, next);
    text.current = next;
    if (added === 0) return;
    budgetMs.current += speechDurationMs(added);
    startedAt.current ??= performance.now();
    setSpeaking(true);
  }, []);

  const finish = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    const elapsed = startedAt.current === null ? 0 : performance.now() - startedAt.current;
    const remaining = Math.max(0, budgetMs.current - elapsed);
    if (remaining === 0) {
      setSpeaking(false);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setSpeaking(false);
    }, remaining);
  }, []);

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
  }, []);

  return { speaking, append, finish, reset };
}
