/**
 * 聊天页的房间（规范 §7.1）：舞台 + 绘本字幕 + 回信条 + 往回翻。
 *
 * 后端契约不变：仍然只走 lib/chat.ts 的 fetchHistory / streamChat（SSE 事件
 * recall / video / web / emotion / delta / done / error），没有新增接口。
 *
 * 分工：
 * - 舞台：VRM 在就画 VRM，不在就贴纸；她在想 / 说话 / 睡着 / 抱歉都由 mood 决定。
 * - 对话框：最后一句「她的话」+ 当前这一轮；idle 时保留上一句，不闪空。
 * - 回信条：Enter 换行、Cmd/Ctrl+Enter 发送；离线仍可打字。
 * - 往回翻：桌面 360 的右栏，手机底部抽屉。
 * 页面里不出现模型名、服务名、技术状态点。
 */
import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { setAvatarStatus, useAvatarStatus } from "../avatar/avatar-state";
import type { AvatarEmotion } from "../avatar/model.config";
import { VrmStage } from "../avatar/VrmStage";
import type { Character } from "../characters";
import { useModel } from "../characters";
import { fetchHealth, type Health } from "../lib/api";
import { clearHistory, fetchHistory, streamChat } from "../lib/chat";
import { Tide } from "./ink";
import { useInkEnv } from "./ink/useCalm";
import { WhaleSticker, type StickerMood } from "./WhaleSticker";
import { Backlog } from "./chat/Backlog";
import { ComposerBar } from "./chat/ComposerBar";
import { ConfirmDialog } from "./chat/ConfirmDialog";
import { DialogBox } from "./chat/DialogBox";
import { Slip } from "./chat/Slip";
import { SuggestionChips } from "./chat/SuggestionChips";
import { useKeyboardInset, useMediaQuery } from "./chat/useViewport";
import type { DialogState, Progress, Turn } from "./chat/types";
import "../styles/chat.css";

interface Props {
  character: Character;
}

type Phase = "idle" | "thinking" | "streaming" | "failed";

let counter = 0;
const nextKey = () => `t${++counter}`;
const HISTORY_LIMIT = 50;

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
    /* 隐私模式 */
  }
}

export function ChatPanel({ character }: Props) {
  const model = useModel();
  const avatar = useAvatarStatus();
  const wide = useMediaQuery("(min-width: 960px)");
  const calm = useInkEnv().calm;
  useKeyboardInset();

  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [showOffline, setShowOffline] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState<{ key: string; chunks: string[] } | null>(null);
  const [progress, setProgress] = useState<Progress | undefined>(undefined);
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [speaking, setSpeaking] = useState(false);
  const [poke, setPoke] = useState(false);
  const [hintSeen, setHintSeen] = useState(readHint);
  const [backlogOpen, setBacklogOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [shareSignal, setShareSignal] = useState(0);
  const [modelTry, setModelTry] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const online = health?.ok === true;
  const busy = phase === "thinking" || phase === "streaming";

  /* ------------------------------------------------------------ 连接与历史 */
  useEffect(() => {
    const ctrl = new AbortController();
    setHistoryLoaded(false);
    fetchHealth(ctrl.signal).then(setHealth);
    fetchHistory(character.id, HISTORY_LIMIT, ctrl.signal).then((history) => {
      setTurns(
        history.map((m) => ({
          key: `h${m.id}`,
          role: m.role === "user" ? "me" : "her",
          text: m.content,
          at: m.createdAt,
          status: "sent",
        })),
      );
      setHistoryLoaded(true);
    });
    return () => ctrl.abort();
  }, [character.id]);

  // 连不上时先等 1.5s，避免一闪一闪过状态。
  useEffect(() => {
    if (health === undefined || health?.ok === true) {
      setShowOffline(false);
      return;
    }
    const timer = setTimeout(() => setShowOffline(true), 1500);
    return () => clearTimeout(timer);
  }, [health]);

  useEffect(() => () => abort.current?.abort(), []);

  const retryHealth = () => {
    setHealth(undefined);
    void fetchHealth().then(setHealth);
  };

  /* ------------------------------------------------------------ 发送一轮 */
  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    const meKey = nextKey();
    const herKey = nextKey();
    const at = new Date().toISOString();
    setDraft("");
    setProgress(undefined);
    setPhase("thinking");
    setTurns((prev) => [
      ...prev.filter((t) => !(t.role === "her" && t.status === "failed" && !t.text)),
      { key: meKey, role: "me", text: message, at, status: "sending" },
      { key: herKey, role: "her", text: "", at, status: "thinking" },
    ]);
    setLive({ key: herKey, chunks: [] });

    const ctrl = new AbortController();
    abort.current = ctrl;
    let started = false;
    try {
      for await (const event of streamChat(message, character.id, ctrl.signal)) {
        if (event.type === "delta") {
          if (!started) {
            started = true;
            setPhase("streaming");
            setSpeaking(true);
            setTurns((prev) => prev.map((t) => (t.key === meKey ? { ...t, status: "sent" } : t)));
          }
          setLive((prev) => (prev && prev.key === herKey ? { ...prev, chunks: [...prev.chunks, event.text] } : prev));
          setTurns((prev) =>
            prev.map((t) => (t.key === herKey ? { ...t, text: t.text + event.text, status: "streaming" } : t)),
          );
        } else if (event.type === "video" || event.type === "web") {
          setProgress({ kind: event.type, stage: event.stage, message: event.message, title: event.title });
        } else if (event.type === "recall") {
          setTurns((prev) => prev.map((t) => (t.key === herKey ? { ...t, recalled: event.memories } : t)));
        } else if (event.type === "emotion") {
          setEmotion(event.emotion);
        } else if (event.type === "done") {
          setTurns((prev) => prev.map((t) => (t.key === herKey ? { ...t, status: "done" } : t)));
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
      setPhase("idle");
      setProgress(undefined);
      setFocusSignal((n) => n + 1);
    } catch {
      if (ctrl.signal.aborted) {
        setTurns((prev) => prev.filter((t) => t.key !== herKey));
        setPhase("idle");
        return;
      }
      setTurns((prev) =>
        prev.map((t) => (t.key === meKey ? { ...t, status: "failed" } : t.key === herKey ? { ...t, text: "", status: "failed" } : t)),
      );
      setPhase("failed");
    } finally {
      setSpeaking(false);
      setProgress(undefined);
      setTurns((prev) => prev.map((t) => (t.key === herKey ? { ...t, status: t.text ? "done" : t.status } : t)));
    }
  };

  const giveUp = () => abort.current?.abort();

  const retrySend = () => {
    const failed = [...turns].reverse().find((t) => t.role === "me" && t.status === "failed");
    if (!failed) return;
    setTurns((prev) => prev.filter((t) => t.status !== "failed"));
    setPhase("idle");
    void send(failed.text);
  };

  const discardSend = () => {
    setTurns((prev) => prev.filter((t) => t.status !== "failed"));
    setPhase("idle");
  };

  const clearAll = () => {
    void clearHistory();
    setTurns([]);
    setPhase("idle");
    setLive(null);
  };

  /* ------------------------------------------------------------ 状态推导 */
  const lastHer = [...turns].reverse().find((t) => t.role === "her");
  const pending = [...turns].reverse().find((t) => t.role === "me");

  const state: DialogState = !historyLoaded
    ? "blank"
    : showOffline
      ? "offline"
      : phase === "failed"
        ? "failed"
        : phase === "thinking"
          ? "thinking"
          : phase === "streaming"
            ? "streaming"
            : avatar === "loading" && turns.length === 0
              ? "loading"
              : lastHer
                ? "done"
                : "idle";

  const text =
    state === "offline"
      ? "网络好像断了，我在这儿等你。"
      : state === "failed"
        ? "这句话没送出去。"
        : state === "loading"
          ? `${character.name}正在赶过来…`
          : lastHer?.text || character.greeting;

  const chunks = live && lastHer && live.key === lastHer.key ? live.chunks : [];
  const showFloat =
    pending?.status === "failed" || (phase === "thinking" && pending?.status === "sending");
  const firstEntry = historyLoaded && turns.length === 0 && !showOffline;

  const mood: StickerMood = poke
    ? "shy"
    : showOffline
      ? "sleep"
      : phase === "failed"
        ? "sorry"
        : phase === "thinking"
          ? "think"
          : speaking
            ? "happy"
            : firstEntry
              ? "wave"
              : "idle";

  const pokeHer = () => {
    setPoke(true);
    window.setTimeout(() => setPoke(false), 1400);
    if (!hintSeen) {
      setHintSeen(true);
      writeHint();
    }
  };

  const backlog = (
    <Backlog
      name={character.name}
      turns={turns}
      variant={wide ? "aside" : "sheet"}
      onClear={() => setConfirmClear(true)}
      onClose={wide ? () => setBacklogOpen(false) : undefined}
    />
  );

  return (
    <>
      <div className="room" data-backlog={wide ? (backlogOpen ? "open" : "closed") : "closed"}>
        <div className="room__main">
          <header className="mbar">
            <span className="mbar__name">{character.name}</span>
            <button type="button" className="mbar__backlog" onClick={() => setSheetOpen(true)}>
              往回翻
            </button>
          </header>

          <section className="scene" aria-label="角色舞台">
            <div
              className="scene__figure"
              role="button"
              tabIndex={0}
              aria-label={`点一点${character.name}`}
              onClick={pokeHer}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pokeHer();
                }
              }}
            >
              {avatar !== "ready" && (
                <div className="scene__sticker" aria-hidden>
                  <WhaleSticker mood={mood} />
                </div>
              )}
              <VrmStage key={`${model.id}-${modelTry}`} modelUrl={model.url} emotion={emotion} speaking={speaking} />
            </div>
            <Tide variant="stage" />

            {(avatar === "failed" || !hintSeen) && (
              <div className="scene__aside">
                {avatar === "failed" && (
                  <div className="scene__asideRow">
                    <p className="scene__note">我的样子暂时没画出来，不影响聊天。</p>
                    <button
                      type="button"
                      className="btn btn--quiet"
                      onClick={() => {
                        setAvatarStatus("loading");
                        setModelTry((n) => n + 1);
                      }}
                    >
                      再试一次
                    </button>
                  </div>
                )}
                {!hintSeen && <p className="scene__note scene__note--tip">点一点她，她会看你哦。</p>}
              </div>
            )}
            {wide && !backlogOpen && (
              <button type="button" className="scene__corner" onClick={() => setBacklogOpen(true)}>
                往回翻
              </button>
            )}
          </section>

          <div className="scene__chrome">
            <DialogBox
              name={character.name}
              state={state}
              text={text}
              chunks={chunks}
              merged={lastHer?.status === "done"}
              stamp={firstEntry}
              progress={progress}
              onRetry={retryHealth}
              onGiveUp={giveUp}
            >
              <AnimatePresence>
                {showFloat && pending && (
                  <motion.div
                    key={pending.key}
                    className="dlg__float"
                    initial={calm ? { opacity: 0 } : { opacity: 0, y: 30, scale: 0.94 }}
                    animate={calm ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                    exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                    transition={calm ? { duration: 0.12 } : { type: "spring", stiffness: 300, damping: 30 }}
                  >
                    <Slip
                      id={pending.key}
                      text={pending.text}
                      float
                      tape
                      status={pending.status === "failed" ? "failed" : "sending"}
                      onRetry={retrySend}
                      onDiscard={discardSend}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              {firstEntry && (
                <SuggestionChips
                  onToday={() => {
                    setDraft("今天……");
                    setFocusSignal((n) => n + 1);
                  }}
                  onVideo={() => setShareSignal((n) => n + 1)}
                />
              )}
            </DialogBox>

            <ComposerBar
              name={character.name}
              value={draft}
              onChange={setDraft}
              onSend={(t) => void send(t)}
              busy={busy}
              online={online}
              focusSignal={focusSignal}
              shareSignal={shareSignal}
            />
          </div>
        </div>

        {wide && <aside className="room__aside">{backlog}</aside>}
      </div>

      {!wide && (
        <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="overlay" />
            <Dialog.Content className="sheet" aria-describedby={undefined}>
              <Dialog.Title className="sr-only">往回翻</Dialog.Title>
              <div className="sheet__grip" aria-hidden />
              {backlog}
              <Dialog.Close className="btn btn--secondary sheet__close">关上</Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="清空聊天记录？"
        body="这里的每一句话都会消失，她也不会再记得聊过什么。日记和「记忆」里收着的东西不受影响。"
        cancelLabel="先留着"
        confirmLabel="清掉"
        danger
        onConfirm={clearAll}
      />
    </>
  );
}
