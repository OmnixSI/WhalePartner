import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { AvatarStatus } from "../../avatar/avatar-state";
import type { AvatarEmotion, AvatarModel } from "../../avatar/model.config";
import type { Character } from "../../characters";
import { Button } from "../ui/Button";
import { SurfStatus, type SurfPhase } from "../surf/SurfStatus";
import { useSurfEvents } from "../surf/useSurfEvents";
import { CharacterMark, type CharacterMood } from "../CharacterMark";
import { Horizon } from "../Horizon";

const Live2DStage = lazy(() => import("../../avatar/Live2DStage").then((module) => ({ default: module.Live2DStage })));

interface Props {
  character: Character;
  model: AvatarModel | null;
  avatar: AvatarStatus;
  emotion: AvatarEmotion;
  speaking: boolean;
  audioDriven?: boolean;
  audioLevel?: { current: number };
  mood: CharacterMood;
  hintSeen: boolean;
  wide: boolean;
  backlogOpen: boolean;
  onPoke: () => void;
  onOpenBacklog: () => void;
}

export function ChatScene({
  character,
  model,
  avatar,
  emotion,
  speaking,
  audioDriven = false,
  audioLevel,
  mood,
  hintSeen,
  wide,
  backlogOpen,
  onPoke,
  onOpenBacklog,
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
        <div className="scene__horizon" aria-hidden />
        <div
          className="scene__figure"
          role="button"
          tabIndex={0}
          aria-label={`点一点${character.name}`}
          // Live2D 的点击由模型自己的 onTap 上报；没有模型时（默认徽记）才由这里上报，避免一次点击触发两遍。
          onClick={model ? undefined : onPoke}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onPoke();
            }
          }}
        >
          {model ? (
            avatar !== "ready" && (
              <div className="scene__wait" aria-hidden>
                <Horizon />
              </div>
            )
          ) : (
            // 没有模型的角色：固定的默认形象 = 她自己的矢量徽记（CharacterMark），不画任何手绘形象
            <div className="scene__sticker" aria-hidden>
              <CharacterMark character={character.id} mood={mood} />
            </div>
          )}
          {model && (
            <Suspense fallback={null}>
              <Live2DStage key={model.id} modelUrl={model.url} emotion={emotion} speaking={speaking} audioDriven={audioDriven} audioLevel={audioLevel} onTap={onPoke} />
            </Suspense>
          )}
        </div>
      </div>

      {(model ? avatar === "ready" : true) && !hintSeen && <p className="scene__tip">点一点她，她会看你哦。</p>}
      {wide && !backlogOpen && (
        <Button className="scene__corner" onClick={onOpenBacklog}>往回翻</Button>
      )}
    </section>
  );
}
