import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { setAvatarStatus, type AvatarStatus } from "../../avatar/avatar-state";
import type { AvatarEmotion, AvatarModel } from "../../avatar/model.config";
import type { Character } from "../../characters";
import { Tide } from "../ink";
import { SurfStatus, type SurfPhase } from "../surf/SurfStatus";
import { useSurfEvents } from "../surf/useSurfEvents";
import type { StickerMood } from "../CharacterMark";
import { Horizon } from "../Horizon";

const Live2DStage = lazy(() => import("../../avatar/Live2DStage").then((module) => ({ default: module.Live2DStage })));
const VrmStage = lazy(() => import("../../avatar/VrmStage").then((module) => ({ default: module.VrmStage })));

interface Props {
  character: Character;
  model: AvatarModel;
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
  hintSeen,
  wide,
  backlogOpen,
  onPoke,
  onOpenBacklog,
  onRetryModel,
}: Props) {
  const sceneRef = useRef<HTMLElement>(null);
  // 舞台自己也量一次对话框高度写进 --scene-safe：形象没出来（加载 / 失败）时，海平线和提示也不会被对话框压住。
  useEffect(() => {
    const scene = sceneRef.current;
    const chrome = scene?.parentElement?.querySelector<HTMLElement>(".scene__chrome");
    if (!scene || !chrome) return;
    const apply = () => {
      const overlays = getComputedStyle(chrome).position === "absolute";
      scene.style.setProperty("--scene-safe", `${overlays ? Math.round(chrome.getBoundingClientRect().height) : 0}px`);
    };
    const observer = new ResizeObserver(apply);
    observer.observe(chrome);
    apply();
    return () => observer.disconnect();
  }, []);
  const [surfPhase, setSurfPhase] = useState<SurfPhase | null>(null);
  useSurfEvents(character.id, {
    onSession: (event) =>
      setSurfPhase(event.state === "start"
        ? { kind: "browsing", stage: "searching" }
        : event.count && event.count > 0 ? { kind: "done", count: event.count } : { kind: "empty" }),
    onStep: (event) => setSurfPhase({ kind: "browsing", stage: event.stage }),
  });

  return (
    <section className="scene" aria-label="角色舞台" ref={sceneRef}>
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
          {avatar !== "ready" && (
            <div className="scene__wait" aria-hidden>
              <Horizon />
            </div>
          )}
          <Suspense fallback={null}>
            {model.renderer === "live2d" ? (
              <Live2DStage key={`${model.id}-${modelTry}`} modelUrl={model.url} emotion={emotion} speaking={speaking} />
            ) : (
              <VrmStage key={`${model.id}-${modelTry}`} modelUrl={model.url} emotion={emotion} speaking={speaking} />
            )}
          </Suspense>
        </div>
        <div className="scene__sea scene__sea--front">
          <div className="scene__sheen" aria-hidden />
          <Tide variant="stage" layers="front" />
        </div>
      </div>

      {avatar === "failed" && (
        <p className="scene__status" role="status">
          我的样子暂时没画出来，不影响聊天。
          <button
            type="button"
            className="scene__retry"
            onClick={() => {
              setAvatarStatus("loading");
              onRetryModel();
            }}
          >
            再试一次
          </button>
        </p>
      )}
      {avatar === "ready" && !hintSeen && <p className="scene__tip">点一点她，她会看你哦。</p>}
      {wide && !backlogOpen && (
        <button type="button" className="scene__corner" onClick={onOpenBacklog}>
          往回翻
        </button>
      )}
    </section>
  );
}
