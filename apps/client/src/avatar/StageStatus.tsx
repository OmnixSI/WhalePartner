import { createPortal } from "react-dom";
import "./stage.css";

export type StagePhase = "loading" | "ready" | "failed";

interface Props {
  phase: StagePhase;
  onRetry: () => void;
}

/**
 * 舞台加载态 / 失败态。不画任何鲸鱼或手绘形象（形象还没来时，宁可安静）。
 */
export function StageStatus({ phase, onRetry }: Props) {
  if (phase === "ready") return null;
  // 加载态的海平线 + 名字由聊天舞台（Horizon）负责；这里只在失败时给一张底部纸条，
  // 样式沿用舞台上的 .scene__status / .scene__retry（chat.css）。
  const strip = (
    <p className="scene__status stage-status__fail" role="status">
      我的样子暂时没画出来，不影响聊天。
      <button type="button" className="scene__retry" onClick={(event) => { event.stopPropagation(); onRetry(); }}>
        再试一次
      </button>
    </p>
  );
  // 纸条要压在浪的上面：聊天舞台里挂到 .scene 上（舞台自己有层叠上下文），引导页等没有 .scene 的地方就地显示。
  const scene = phase === "failed" && typeof document !== "undefined" ? document.querySelector<HTMLElement>(".scene") : null;
  return (
    <>
      <div className="stage-status" data-phase={phase} role="status" aria-live="polite">
        {phase === "loading" && <span className="stage-status__sr">形象加载中</span>}
        {phase === "failed" && !scene && strip}
      </div>
      {phase === "failed" && scene && createPortal(strip, scene)}
    </>
  );
}
