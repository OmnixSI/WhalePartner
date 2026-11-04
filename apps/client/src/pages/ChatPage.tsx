import { ChatPanel } from "../components/ChatPanel";
import { WhaleFigure } from "../components/WhaleFigure";

export function ChatPage() {
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
        <WhaleFigure />
        <p className="stage__hint">原创角色设定 · 与 DeepSeek 及其他社区角色无关</p>
      </section>
      <ChatPanel />
    </div>
  );
}
