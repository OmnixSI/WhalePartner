import { AnimatePresence, motion } from "motion/react";
import type { AvatarEmotion } from "../../avatar/model.config";
import { calmFade, spring } from "../../motion/tokens";
import { DialogBox } from "./DialogBox";
import { ComposerBar } from "./ComposerBar";
import { Slip } from "./Slip";
import { SuggestionChips } from "./SuggestionChips";
import type { DialogState, Progress, Turn } from "./types";

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
  onRetrySend: () => void;
  onDiscardSend: () => void;
  onToday: () => void;
  onVideo: () => void;
  onDraftChange: (value: string) => void;
  onSend: (text: string) => void;
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
  onRetrySend,
  onDiscardSend,
  onToday,
  onVideo,
  onDraftChange,
  onSend,
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
        stamp={firstEntry}
        progress={progress}
        onRetry={onRetryHealth}
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
                tape
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
        busy={busy}
        online={online}
        focusSignal={focusSignal}
        shareSignal={shareSignal}
      />
    </div>
  );
}
