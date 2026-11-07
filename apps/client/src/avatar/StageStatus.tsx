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
  return (
    <div className="stage-status" data-phase={phase} role="status" aria-live="polite">
      {phase === "failed" ? (
        <p className="scene__status stage-status__fail">
          我的样子暂时没画出来，不影响聊天。
          <button type="button" className="scene__retry" onClick={(event) => { event.stopPropagation(); onRetry(); }}>
            再试一次
          </button>
        </p>
      ) : (
        <span className="stage-status__sr">形象加载中</span>
      )}
    </div>
  );
}
