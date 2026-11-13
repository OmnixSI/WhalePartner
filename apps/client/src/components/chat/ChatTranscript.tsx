import { AnimatePresence, motion } from "motion/react";
import type { AvatarEmotion } from "../../avatar/model.config";
import { calmFade, spring } from "../../motion/tokens";
import { DialogBox } from "./DialogBox";
import { ComposerBar } from "./ComposerBar";
import { Slip } from "./Slip";
import { SuggestionChips } from "./SuggestionChips";
import type { DialogState, Progress, Turn } from "./types";
import type { VoicePhase } from "./useVoiceMode";

interface Props {
  name: string;
  state: DialogState;
  emotion: AvatarEmotion;
  text: string;
  chunks: string[];
  merged: boolean;
  firstEntry: boolean;
  progress?: Progress;
  pending?: Turn;
  showFloat: boolean;
  calm: boolean;
  draft: string;
  busy: boolean;
  online: boolean;
  focusSignal: number;
  shareSignal: number;
  onRetryHealth: () => void;
  onGiveUp: () => void;
  onStop: () => void;
  /** 失败时展示给用户的原因。 */
  detail?: string;
  /** 失败态「再试一次」。 */
  onRetryFailed?: () => void;
  /** 她「正在打字」（按句分条出现的间隙）。 */
  typing?: boolean;
  /** 读屏播报的完整原文（不随按句分条逐句变长）。 */
  announce?: string;
  onRetrySend: () => void;
  onDiscardSend: () => void;
  onToday: () => void;
  onVideo: () => void;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void;
  voicePhase?: VoicePhase;
  voiceRecording?: boolean;
  voiceMessage?: string;
  onStartVoice?: () => void;
  onFinishVoice?: () => void;
  onCancelRecording?: () => void;
  onStopVoice?: () => void;
  onRetryVoice?: () => void;
}

export function ChatTranscript({
  name,
  state,
  emotion,
  text,
  chunks,
  merged,
  firstEntry,
  progress,
  pending,
  showFloat,
  calm,
  draft,
  busy,
  online,
  focusSignal,
  shareSignal,
  onRetryHealth,
  onGiveUp,
  onStop,
  detail,
  onRetryFailed,
  typing,
  announce,
  onRetrySend,
  onDiscardSend,
  onToday,
  onVideo,
  onDraftChange,
  onSend,
  voicePhase,
  voiceRecording,
  voiceMessage,
  onStartVoice,
  onFinishVoice,
  onCancelRecording,
  onStopVoice,
  onRetryVoice,
}: Props) {
  return (
    <div className="scene__chrome">
      <DialogBox
        name={name}
        state={state}
        emotion={emotion}
        text={text}
        chunks={chunks}
        merged={merged}
        progress={progress}
        onRetry={onRetryHealth}
        onRetryFailed={onRetryFailed}
        detail={detail}
        typing={typing}
        announce={announce}
        onGiveUp={onGiveUp}
      >
        <AnimatePresence>
          {showFloat && pending && (
            <motion.div
              key={pending.key}
              className="dlg__float"
              initial={calm ? { opacity: 0 } : { opacity: 0, y: 30, scale: 0.94 }}
              animate={calm ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={calm ? calmFade : spring.soft}
            >
              <Slip
                id={pending.key}
                text={pending.text}
                float
                status={pending.status === "failed" ? "failed" : "sending"}
                onRetry={onRetrySend}
                onDiscard={onDiscardSend}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {firstEntry && <SuggestionChips onToday={onToday} onVideo={onVideo} />}
      </DialogBox>

      <ComposerBar
        name={name}
        value={draft}
        onChange={onDraftChange}
        onSend={onSend}
        onStop={onStop}
        busy={busy}
        online={online}
        focusSignal={focusSignal}
        shareSignal={shareSignal}
        voicePhase={voicePhase}
        voiceRecording={voiceRecording}
        voiceMessage={voiceMessage}
        onStartVoice={onStartVoice}
        onFinishVoice={onFinishVoice}
        onCancelRecording={onCancelRecording}
        onStopVoice={onStopVoice}
        onRetryVoice={onRetryVoice}
      />
    </div>
  );
}
