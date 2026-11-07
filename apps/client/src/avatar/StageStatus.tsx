import "./stage.css";

export type StagePhase = "loading" | "ready" | "failed";

interface Props {
  phase: StagePhase;
  onRetry: () => void;
}

/**
 * 舞台加载态 / 失败态。刻意只用一条海平线和一行字：
 * 不画任何鲸鱼或手绘形象（形象还没来时，宁可安静）。
 */
export function StageStatus({ phase, onRetry }: Props) {
  if (phase === "ready") return null;
  return (
    <div className="stage-status" data-phase={phase} role="status" aria-live="polite">
      <div className="stage-status__horizon" aria-hidden />
      {phase === "failed" && (
        <div className="stage-status__fail">
          <p className="stage-status__text">形象没能加载出来，不影响聊天。</p>
          <button type="button" className="btn btn--quiet" onClick={(event) => { event.stopPropagation(); onRetry(); }}>
            重试
          </button>
        </div>
      )}
      {phase === "loading" && <span className="stage-status__sr">形象加载中</span>}
    </div>
  );
}
