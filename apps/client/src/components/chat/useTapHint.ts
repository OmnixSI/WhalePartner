import { useCallback, useEffect, useRef, useState } from "react";

const HINT_KEY = "wp.hint.poke";

function readHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

function writeHint() {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Local storage can be unavailable in a private window.
  }
}

export function useTapHint() {
  const [active, setActive] = useState(false);
  const [hintSeen, setHintSeen] = useState(readHint);
  const seen = useRef(hintSeen);
  const timer = useRef<number | undefined>(undefined);

  const activate = useCallback(() => {
    setActive(true);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setActive(false);
    }, 1400);
    if (!seen.current) {
      seen.current = true;
      setHintSeen(true);
      writeHint();
    }
  }, []);

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
  }, []);

  return { active, hintSeen, activate };
}
