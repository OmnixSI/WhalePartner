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
import { Dialog } from "radix-ui";
import { useState } from "react";
import { useAvatarStatus } from "../avatar/avatar-state";
import type { Character } from "../characters";
import { useModel } from "../characters";
import { ChatScene } from "./chat/ChatScene";
import { ChatTranscript } from "./chat/ChatTranscript";
import { useInkEnv } from "./ink/useCalm";
import { useSpeechAnimation } from "../avatar/live2d/useSpeechAnimation";
import { useTapHint } from "./chat/useTapHint";
import { useSharedChat } from "./chat/useSharedChat";
import type { StickerMood } from "./WhaleSticker";
import { Backlog } from "./chat/Backlog";
import { ConfirmDialog } from "./chat/ConfirmDialog";
import { stripEmotionTags } from "../lib/emotion";
import { useKeyboardInset, useMediaQuery } from "./chat/useViewport";
import type { DialogState } from "./chat/types";
import "../styles/chat.css";

interface Props {
  character: Character;
}

export function ChatPanel({ character }: Props) {
  const model = useModel();
  const avatar = useAvatarStatus();
  const wide = useMediaQuery("(min-width: 960px)");
  const calm = useInkEnv().calm;
  useKeyboardInset();

  const speech = useSpeechAnimation();
  const chat = useSharedChat(character.id, speech);
  const {
    showOffline,
    online,
    busy,
    turns,
    historyLoaded,
    draft,
    setDraft,
    phase,
    live,
    progress,
    emotion,
    focusSignal,
    shareSignal,
    setShareSignal,
    retryHealth,
    send,
    giveUp,
    retrySend,
    discardSend,
    clearAll,
    today,
  } = chat;
  const { active: poke, hintSeen, activate: pokeHer } = useTapHint();
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [modelTry, setModelTry] = useState(0);
  const speaking = speech.speaking;
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
          : stripEmotionTags(lastHer?.text || character.greeting);

  // 流式分片也过一遍：标签绝不能漏进字幕（前端不赌后端版本）。
  const chunks = live && lastHer && live.key === lastHer.key ? live.chunks.map(stripEmotionTags) : [];
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

          <ChatScene
            character={character}
            model={model}
            avatar={avatar}
            modelTry={modelTry}
            emotion={emotion}
            speaking={speaking}
            mood={mood}
            hintSeen={hintSeen}
            wide={wide}
            backlogOpen={backlogOpen}
            onPoke={pokeHer}
            onOpenBacklog={() => setBacklogOpen(true)}
            onRetryModel={() => setModelTry((n) => n + 1)}
          />

          <ChatTranscript
            name={character.name}
            state={state}
            emotion={busy ? emotion : lastHer?.emotion ?? emotion}
            text={text}
            chunks={chunks}
            merged={lastHer?.status === "done"}
            firstEntry={firstEntry}
            progress={progress}
            pending={pending}
            showFloat={showFloat}
            calm={calm}
            draft={draft}
            busy={busy}
            online={online}
            focusSignal={focusSignal}
            shareSignal={shareSignal}
            onRetryHealth={retryHealth}
            onGiveUp={giveUp}
            onRetrySend={retrySend}
            onDiscardSend={discardSend}
            onToday={today}
            onVideo={() => setShareSignal((n) => n + 1)}
            onDraftChange={setDraft}
            onSend={(value) => void send(value)}
          />
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
