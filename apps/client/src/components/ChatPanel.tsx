/**
 * 聊天页的房间（规范 §7.1）：舞台 + 绘本字幕 + 回信条 + 往回翻。
 *
 * 后端契约不变：仍然只走 lib/chat.ts 的 fetchHistory / streamChat（SSE 事件
 * recall / video / web / emotion / delta / done / error），没有新增接口。
 *
 * 分工：
 * - 舞台：大肥鱼使用 Live2D；没有模型的人格使用贴纸。情绪由 mood 驱动。
 * - 对话框：最后一句「她的话」+ 当前这一轮；idle 时保留上一句，不闪空。
 * - 回信条：Enter 发送、Shift+Enter 换行（设置里可切回 Cmd/Ctrl+Enter）；生成中发送键变「停」；离线仍可打字。
 * - 往回翻：桌面 360 的右栏，手机底部抽屉。
 * 页面里不出现模型名、服务名、技术状态点。
 */
import { Dialog } from "radix-ui";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { useAvatarStatus } from "../avatar/avatar-state";
import type { Character } from "../characters";
import { useModel } from "../characters";
import { ChatScene } from "./chat/ChatScene";
import { ChatTranscript } from "./chat/ChatTranscript";
import { ChatThread } from "./chat/ChatThread";
import { visibleTurns } from "./chat/chatThreadUtils";
import { useInkEnv } from "./ink/useCalm";
import { useSpeechAnimation } from "../avatar/live2d/useSpeechAnimation";
import { useTapHint } from "./chat/useTapHint";
import { useSharedChat } from "./chat/useSharedChat";
import { usePacedReply } from "./chat/usePacedReply";
import { useVoiceMode } from "./chat/useVoiceMode";
import { useVoiceOutput } from "./chat/useVoiceOutput";
import { PREFS_EVENT, readPace } from "../lib/chat-prefs";
import { sliceChunks } from "../lib/reply";
import type { CharacterMood } from "./CharacterMark";
import { Backlog } from "./chat/Backlog";
import { Button } from "./ui/Button";
import { stripEmotionTags } from "../lib/emotion";
import { useKeyboardInset, useMediaQuery } from "./chat/useViewport";
import type { DialogState } from "./chat/types";
import "../styles/chat.css";

// 只有点「清空」才用得到，不进首屏
const ConfirmDialog = lazy(() => import("./ui/Dialog").then((m) => ({ default: m.ConfirmDialog })));
// 只有好感度跨档才用得到（吐司 + Toaster），不进首屏
const LevelUpToast = lazy(() => import("./chat/LevelUpToast"));

interface Props {
  character: Character;
}

export function ChatPanel({ character }: Props) {
  const model = useModel();
  const avatar = useAvatarStatus();
  const wide = useMediaQuery("(min-width: 960px)");
  const threadWide = useMediaQuery("(min-width: 1180px)");
  const calm = useInkEnv().calm;
  useKeyboardInset();

  const speech = useSpeechAnimation();
  const voiceOutput = useVoiceOutput();
  const chat = useSharedChat(character.id, speech, voiceOutput, voiceOutput.speaking);
  const voice = useVoiceMode({
    assistantBusy: chat.busy,
    assistantSpeaking: voiceOutput.speaking,
    onTranscript: (text) => { void chat.send(text); },
    onInterrupt: (reason) => { voiceOutput.stop(reason); speech.reset(); chat.interrupt(); },
  });
  const {
    showOffline,
    starting,
    needsPair,
    failure,
    stop,
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
  const previousCharacter = useRef(character.id);
  useEffect(() => {
    if (previousCharacter.current === character.id) return;
    previousCharacter.current = character.id;
    voice.stop();
    voiceOutput.setEnabled(false);
    speech.reset();
  }, [character.id, speech.reset, voice.stop, voiceOutput.setEnabled]);
  useEffect(() => {
    voiceOutput.setEnabled(voice.active && voice.phase !== "error" && character.id === "deepseek");
  }, [character.id, voice.active, voice.phase, voiceOutput.setEnabled]);
  const startVoice = () => {
    if (!voice.active) {
      speech.reset();
      voiceOutput.activate(character.id === "deepseek");
    }
    voice.toggleRecording();
  };
  const stopVoice = () => {
    voice.stop();
    voiceOutput.setEnabled(false);
    speech.reset();
  };
  const retryVoice = () => {
    speech.reset();
    voiceOutput.activate(character.id === "deepseek");
    voice.retry();
  };
  const stopChat = () => {
    voiceOutput.stop();
    stop();
  };
  // 见闻页「和她聊聊」：?quote= 预填输入框，读完立刻把参数清掉（刷新不会重复塞）。
  const [searchParams, setSearchParams] = useSearchParams();
  const quote = searchParams.get("quote");
  useEffect(() => {
    if (!quote || !historyLoaded) return;
    setDraft(draft.trim() ? `${draft}\n${quote}` : quote);
    const next = new URLSearchParams(searchParams);
    next.delete("quote");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, historyLoaded]);
  const [backlogOpen, setBacklogOpen] = useState(false);
  // 往回翻的触发按钮在 Dialog.Root 外面（宽屏时 Root 不挂载），受控打开时 Radix 不知道关上后焦点还给谁，所以自己还。
  const sheetTrigger = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [levelUp, setLevelUp] = useState<{ level: number; n: number } | null>(null);
  // 一轮聊天正常结束（不是失败）后，看一眼好感度有没有跨档
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) { wasBusy.current = true; return; }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    if (phase === "failed") return;
    const id = character.id;
    void import("../lib/level-up").then(({ checkLevelUp }) => checkLevelUp(id)).then((level) => {
      if (level !== null) setLevelUp((prev) => ({ level, n: (prev?.n ?? 0) + 1 }));
    });
  }, [busy, phase, character.id]);
  const [confirmUsed, setConfirmUsed] = useState(false);
  const speaking = speech.speaking || voiceOutput.speaking;
  const voiceMessage = voice.phase === "error"
    ? voice.message
    : voice.phase === "preparing"
      ? "正在准备语音"
      : voice.phase === "permission"
        ? "等待麦克风权限"
        : voice.phase === "recognizing"
          ? "识别中"
          : voice.recording
            ? voice.message || "正在录音"
            : voice.phase === "thinking"
              ? "正在等待回复"
              : voiceOutput.speaking
                ? "大肥鱼正在回答，说话会打断"
                : voice.active && character.id !== "deepseek"
                  ? "语音输入可用，语音回复支持大肥鱼"
                  : voiceOutput.model.state === "failed" || voiceOutput.error
                    ? `语音回复暂不可用：${voiceOutput.error || voiceOutput.model.message}`
                    : voiceOutput.model.state === "loading"
                      ? "语音回复准备中"
                      : voice.message;
  /* ------------------------------------------------------------ 状态推导 */
  const lastHer = [...turns].reverse().find((t) => t.role === "her" && (t.text || t.status !== "failed" || phase === "failed"));
  const pending = [...turns].reverse().find((t) => t.role === "me");
  const paceOn = useSyncExternalStore(
    (cb) => { window.addEventListener(PREFS_EVENT, cb); return () => window.removeEventListener(PREFS_EVENT, cb); },
    readPace,
    () => true,
  );
  const liveHere = Boolean(live && lastHer && live.key === lastHer.key);
  const paced = usePacedReply({ key: lastHer?.key, text: stripEmotionTags(lastHer?.text ?? ""), fresh: liveHere, enabled: paceOn });

  const state: DialogState = !historyLoaded
    ? "blank"
    : needsPair
      ? "offline"
      : starting
        ? "loading"
        : showOffline
          ? "offline"
      : phase === "failed"
        ? "failed"
        : phase === "thinking"
          ? "thinking"
          : phase === "streaming"
            ? "streaming"
              : model && avatar === "loading" && turns.length === 0
              ? "loading"
              : lastHer
                ? "done"
                : "idle";

  const shown = paced.parts.length > 0 ? paced.parts.slice(0, paced.revealed).join("\n\n") : "";
  const text =
    state === "offline"
      ? needsPair
        ? "还没连上你的鲸汐。到「设置 › 连接到我的鲸汐」输入配对码就好。"
        : "网络好像断了，我在这儿等你。"
      : state === "failed"
        ? failure?.message ?? "这句话没送出去。"
        : state === "loading"
          ? starting
            ? `${character.name}马上就来…`
            : `${character.name}正在赶过来…`
          : lastHer?.text ? (shown || stripEmotionTags(lastHer.text)) : character.greeting;

  // 流式分片也过一遍：标签绝不能漏进字幕（前端不赌后端版本）。按句分条时只亮出已「发出」的那几条。
  const allChunks = liveHere && live ? live.chunks.map(stripEmotionTags) : [];
  const chunks = (() => {
    if (!paceOn || paced.parts.length <= 1) return allChunks;
    const out: string[] = [];
    let offset = 0;
    paced.parts.slice(0, paced.revealed).forEach((part, index) => {
      if (index > 0) out.push("\n\n");
      out.push(...sliceChunks(allChunks, offset, offset + part.length));
      offset += part.length;
    });
    return out;
  })();
  const showFloat =
    pending?.status === "failed" || (phase === "thinking" && pending?.status === "sending");
  const firstEntry = historyLoaded && turns.length === 0 && !showOffline;

  const mood: CharacterMood = poke
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

  // 宽屏右栏是「最近的对话」：还没有可看的对话时整栏不留，舞台和对话区铺满内容区（不留一块空白）。
  const threadExclude = phase === "streaming" ? lastHer?.key : undefined;
  const hasThread = visibleTurns(turns, threadExclude, 1).length > 0;
  const asideOpen = threadWide ? backlogOpen || hasThread : wide && backlogOpen;

  const backlog = (
    <Backlog
      name={character.name}
      turns={turns}
      variant={wide ? "aside" : "sheet"}
      onClear={() => { setConfirmUsed(true); setConfirmClear(true); }}
      onClose={wide ? () => setBacklogOpen(false) : undefined}
    />
  );

  return (
    <>
      <div className="room" data-backlog={asideOpen ? "open" : "closed"}>
        <div className="room__main">
          <header className="mbar">
            <span className="mbar__name">{character.name}</span>
            <Button ref={sheetTrigger} variant="ghost" onClick={() => setSheetOpen(true)}>往回翻</Button>
          </header>

          <ChatScene
            character={character}
            model={model}
            avatar={avatar}
            emotion={emotion}
            speaking={speaking}
            audioDriven={voiceOutput.speaking}
            audioLevel={voiceOutput.audioLevel}
            mood={mood}
            hintSeen={hintSeen}
            wide={wide}
            backlogOpen={backlogOpen}
            onPoke={pokeHer}
            onOpenBacklog={() => setBacklogOpen(true)}
          />

          {!threadWide && (
            <ChatThread
              name={character.name}
              turns={turns}
              variant="compact"
              excludeKey={phase === "streaming" ? lastHer?.key : undefined}
              announce={state === "done"}
              announceText={lastHer?.text}
            />
          )}

          <ChatTranscript
            name={character.name}
            state={state}
            emotion={busy ? emotion : lastHer?.emotion ?? emotion}
            text={text}
            chunks={chunks}
            merged={lastHer?.status === "done" && !paced.typing}
            typing={paced.typing}
            detail={failure?.message}
            onRetryFailed={retrySend}
            onStop={stopChat}
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
            voicePhase={voice.phase}
            voiceRecording={voice.recording}
            voiceMessage={voiceMessage}
            onStartVoice={startVoice}
            onFinishVoice={() => { void voice.finishRecording(); }}
            onCancelRecording={() => { void voice.cancelRecording(); }}
            onStopVoice={stopVoice}
            onRetryVoice={retryVoice}
          />
        </div>

        {threadWide && asideOpen && (
          <aside className="room__aside">
            {backlogOpen ? backlog : (
              <ChatThread
                name={character.name}
                turns={turns}
                variant="aside"
                excludeKey={phase === "streaming" ? lastHer?.key : undefined}
                announce={state === "done"}
                announceText={lastHer?.text}
                onOpenBacklog={() => setBacklogOpen(true)}
              />
            )}
          </aside>
        )}
        {!threadWide && wide && backlogOpen && <aside className="room__aside">{backlog}</aside>}
      </div>

      {!wide && (
        <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="overlay" />
            <Dialog.Content
              className="sheet"
              aria-describedby={undefined}
              onCloseAutoFocus={(e) => {
                const el = sheetTrigger.current;
                if (el?.isConnected) { e.preventDefault(); el.focus(); }
              }}
            >
              <Dialog.Title className="sr-only">往回翻</Dialog.Title>
              <div className="sheet__grip" aria-hidden />
              {backlog}
              <Dialog.Close asChild><Button className="sheet__close">关上</Button></Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {levelUp && (
        <Suspense fallback={null}>
          <LevelUpToast key={levelUp.n} level={levelUp.level} />
        </Suspense>
      )}

      {confirmUsed && (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={confirmClear}
            onOpenChange={setConfirmClear}
            title="清空聊天记录？"
            description="这里的每一句话都会消失，她也不会再记得聊过什么。日记和「记忆」里收着的东西不受影响。"
            cancelLabel="先留着"
            confirmLabel="清掉"
            tone="danger"
            onConfirm={clearAll}
          />
        </Suspense>
      )}
    </>
  );
}
