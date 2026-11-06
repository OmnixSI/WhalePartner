import { useState } from "react";
import { useAvatarStatus } from "../avatar/avatar-state";
import type { AvatarEmotion } from "../avatar/model.config";
import { Live2DStage } from "../avatar/Live2DStage";
import { VrmStage } from "../avatar/VrmStage";
import { useCharacter, useModel } from "../characters";
import { ChatPanel } from "../components/ChatPanel";
import { WhaleFigure } from "../components/WhaleFigure";

export function ChatPage() {
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [speaking, setSpeaking] = useState(false);
  const status = useAvatarStatus();
  const character = useCharacter();
  const model = useModel();

  return (
    <div className="home">
      <section className="stage" aria-label="角色舞台">
        <div className="stage__tag">
          <div>
            <div className="stage__name">{character.name}</div>
            <div className="stage__sub">{character.fan ? `${character.tagline} · 同人演示` : character.tagline}</div>
          </div>
        </div>
        {model.renderer === "live2d" ? (
          <>
            {status !== "ready" && <WhaleFigure />}
            <Live2DStage key={model.id} modelUrl={model.url} emotion={emotion} speaking={speaking} />
          </>
        ) : (
          <>
            {status !== "ready" && <WhaleFigure />}
            <VrmStage key={model.id} modelUrl={model.url} emotion={emotion} speaking={speaking} />
          </>
        )}
        <p className="stage__hint">{status === "failed" ? "形象暂时无法加载" : model.renderer === "live2d" ? "点一点她，看看反应" : "演示形象 · 仅内部展示"}</p>
      </section>
      <ChatPanel key={character.id} character={character} onEmotion={setEmotion} onSpeaking={setSpeaking} />
    </div>
  );
}
