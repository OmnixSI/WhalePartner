import { lazy, Suspense, useState } from "react";
import { setAvatarStatus, type AvatarStatus } from "../../avatar/avatar-state";
import type { AvatarEmotion, AvatarModel } from "../../avatar/model.config";
import type { Character } from "../../characters";
import { Tide } from "../ink";
import { SurfStatus, type SurfPhase } from "../surf/SurfStatus";
import { useSurfEvents } from "../surf/useSurfEvents";
import { WhaleSticker, type StickerMood } from "../WhaleSticker";

const Live2DStage = lazy(() => import("../../avatar/Live2DStage").then((module) => ({ default: module.Live2DStage })));

interface Props {
  character: Character;
  model: AvatarModel | null;
  avatar: AvatarStatus;
  modelTry: number;
  emotion: AvatarEmotion;
  speaking: boolean;
  mood: StickerMood;
  hintSeen: boolean;
  wide: boolean;
  backlogOpen: boolean;
  onPoke: () => void;
  onOpenBacklog: () => void;
  onRetryModel: () => void;
}

export function ChatScene({
  character,
  model,
  avatar,
  modelTry,
  emotion,
  speaking,
  mood,
  hintSeen,
  wide,
  backlogOpen,
  onPoke,
  onOpenBacklog,
  onRetryModel,
}: Props) {
  const [surfPhase, setSurfPhase] = useState<SurfPhase | null>(null);
  useSurfEvents(character.id, {
    onSession: (event) =>
      setSurfPhase(event.state === "start"
        ? { kind: "browsing", stage: "searching" }
        : event.count && event.count > 0 ? { kind: "done", count: event.count } : { kind: "empty" }),
    onStep: (event) => setSurfPhase({ kind: "browsing", stage: event.stage }),
  });

  return (
    <section className="scene" aria-label="角色舞台">
      <SurfStatus phase={surfPhase} onDismiss={() => setSurfPhase(null)} />
      <div className="scene__safe">
        <div className="scene__glow" aria-hidden />
        <div className="scene__sea scene__sea--back">
          <Tide variant="stage" layers="back" />
        </div>
        <div
          className="scene__figure"
          role="button"
          tabIndex={0}
          aria-label={`点一点${character.name}`}
          onClick={onPoke}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onPoke();
            }
          }}
        >
          {(!model || avatar !== "ready") && (
            <div className="scene__sticker" aria-hidden>
              <WhaleSticker mood={mood} />
            </div>
          )}
          {model && (
            <Suspense fallback={null}>
              <Live2DStage key={`${model.id}-${modelTry}`} modelUrl={model.url} emotion={emotion} speaking={speaking} />
            </Suspense>
          )}
        </div>
        <div className="scene__sea scene__sea--front">
          <div className="scene__sheen" aria-hidden />
          <Tide variant="stage" layers="front" />
        </div>
      </div>

      {((model && avatar === "failed") || !hintSeen) && (
        <div className="scene__aside">
          {model && avatar === "failed" && (
            <div className="scene__asideRow">
              <p className="scene__note">
                我的样子要 Live2D 才能画出来：把 live2dcubismcore.min.js 放进 apps/client/public/live2d/libs/ 就好，不影响聊天。
              </p>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  setAvatarStatus("loading");
                  onRetryModel();
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
        <button type="button" className="scene__corner" onClick={onOpenBacklog}>
          往回翻
        </button>
      )}
    </section>
  );
}
