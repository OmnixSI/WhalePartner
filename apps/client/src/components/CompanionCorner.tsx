/**
 * 每页都有她的小角（规范 §5.7）：右下角一枚 112×112（手机 64×64）的角色贴纸按钮。
 *
 * - 永远用 `WhaleSticker`，**不初始化第二个 Live2D/VRM 实例**；各角色的 Live2D/VRM 形象只出现在聊天页主舞台。
 * - 是 `<button>`，`aria-label="和{名字}打个招呼"`，点击时弹簧 400/17 跳一下（y 0 → -10 → 0），
 *   旁边冒一张便签小字（3 秒消失，role="status"），台词按当前 mood 取；**10 秒内不重复触发**。
 * - mood 由页面推：`setCompanionMood("write")` / `setCompanionMood("happy", { ttl: 2400 })`，
 *   也可以直接 `<CompanionCorner mood={...} />`。带 ttl 的会在到期后自己回到 idle。
 * - 聊天页自己有舞台，不挂这个组件。
 */
import { motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCharacter } from "../characters";
import { WhaleSticker, type StickerMood } from "./WhaleSticker";
import "../styles/sticker.css";

/* ---------------- 状态：同 avatar-state.ts 的写法 ---------------- */

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const notify = () => listeners.forEach((listener) => listener());

let mood: StickerMood = "idle";
let timer: ReturnType<typeof setTimeout> | null = null;

/** 页面用这个推状态；ttl 到期自动回 idle。 */
export function setCompanionMood(next: StickerMood, opts: { ttl?: number } = {}) {
  mood = next;
  notify();
  if (timer) clearTimeout(timer);
  timer = opts.ttl && opts.ttl > 0
    ? setTimeout(() => {
        mood = "idle";
        timer = null;
        notify();
      }, opts.ttl)
    : null;
}

export const useCompanionMood = () => useSyncExternalStore(subscribe, () => mood);

/* ---------------- 台词（规范 §5.7 的表） ---------------- */

const LINES: Record<StickerMood, string[]> = {
  idle: ["今天的我写在这里了。", "想看哪一天？"],
  write: ["我在写，你先歇会儿。"],
  happy: ["写好啦。"],
  hold: ["这些都是我收好的。"],
  sorry: ["好，我不记这件事了。"],
  wave: ["有哪里不方便，告诉我。"],
  sleep: ["我睡着了，网络回来我就醒。"],
  phone: ["我逛到的都放在这儿。"],
  paper: ["我在看报纸呢，等我一下。"],
  think: ["让我想想。"],
};

/** 10 秒内不重复触发（规范 §5.7）。 */
const CLICK_GAP = 10_000;

type Props = {
  /** 不传就用 `setCompanionMood` 推的全局 mood */
  mood?: StickerMood;
  className?: string;
};

export function CompanionCorner({ mood: moodProp, className = "" }: Props) {
  const storeMood = useCompanionMood();
  const current = moodProp ?? storeMood;
  const character = useCharacter();
  const [lifted, setLifted] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lastClick = useRef(0);
  const liftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (liftTimer.current) clearTimeout(liftTimer.current);
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  const onClick = () => {
    const now = Date.now();
    if (now - lastClick.current < CLICK_GAP) return;
    lastClick.current = now;
    // 跳一下：0 → -10 → 0，弹簧 400/17
    setLifted(true);
    if (liftTimer.current) clearTimeout(liftTimer.current);
    liftTimer.current = setTimeout(() => setLifted(false), 180);
    // 便签小字，3 秒消失
    const pool = LINES[current] ?? LINES.idle;
    setNote(pool[Math.floor(Math.random() * pool.length)]);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 3000);
  };

  return (
    <div className={`companion ${className}`.trim()}>
      {note && (
        <p className="companion__note" role="status">
          {note}
        </p>
      )}
      <motion.button
        type="button"
        className="companion__btn"
        aria-label={`和${character.name}打个招呼`}
        onClick={onClick}
        animate={{ y: lifted ? -10 : 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
      >
        <WhaleSticker mood={current} className="companion__sticker" />
      </motion.button>
    </div>
  );
}
