import { useState } from "react";
import { useAvatarStatus } from "../avatar/avatar-state";
import type { AvatarEmotion } from "../avatar/model.config";
import { VrmStage } from "../avatar/VrmStage";
import { ChatPanel } from "../components/ChatPanel";
import { WhaleFigure } from "../components/WhaleFigure";

export function ChatPage() {
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [speaking, setSpeaking] = useState(false);
  const status = useAvatarStatus();

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
        <VrmStage emotion={emotion} speaking={speaking} />
        <p className="stage__hint">演示形象 · 原创角色设定与 DeepSeek 及其他社区角色无关</p>
      </section>
      <ChatPanel onEmotion={setEmotion} onSpeaking={setSpeaking} />
    </div>
  );
}
