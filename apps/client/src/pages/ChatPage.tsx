import { useState } from "react";
import { useAvatarModel, useAvatarStatus } from "../avatar/avatar-state";
import type { AvatarEmotion } from "../avatar/model.config";
import { VrmStage } from "../avatar/VrmStage";
import { ChatPanel } from "../components/ChatPanel";
import { WhaleFigure } from "../components/WhaleFigure";

export function ChatPage() {
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [speaking, setSpeaking] = useState(false);
  const status = useAvatarStatus();
  const model = useAvatarModel();

  return (
    <div className="home">
      <section className="stage" aria-label="角色舞台">
        <div className="stage__tag">
          <div>
            <div className="stage__name">鲸汐</div>
            <div className="stage__latin">Jingxi · your ocean friend</div>
          </div>
          <span className="badge">原创角色</span>
        </div>
        {status !== "ready" && <WhaleFigure />}
        <VrmStage modelUrl={model.url} emotion={emotion} speaking={speaking} />
        <p className="stage__hint">演示形象 · 现成模型，仅内部展示</p>
      </section>
      <ChatPanel onEmotion={setEmotion} onSpeaking={setSpeaking} />
    </div>
  );
}
