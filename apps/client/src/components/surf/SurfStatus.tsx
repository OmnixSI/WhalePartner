/**
 * SurfStatus（规范 §7.7.3）：舞台 / 见闻页左上角那张「她在逛」的小便签。
 * 收到 `session{start}` 显示、`end` 后淡出；字随 `step.stage` 变。
 * 聊天页把它挂在舞台上（那是 P1 的组件范围，这一版先在见闻页顶部用同一份实现）。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IconName } from "../ink-icons";
import { Tape } from "../ink";
import { useInkEnv } from "../ink/useCalm";
import type { SurfStage } from "./useSurfEvents";

export type SurfPhase =
  | { kind: "browsing"; stage: SurfStage }
  | { kind: "done"; count: number }
  | { kind: "empty" };

const STAGE_TEXT: Record<SurfStage, string> = {
  searching: "在找想看的东西…",
  watching: "在看一个视频…",
  reading: "在翻网页…",
  writing: "在记下来…",
};

const STAGE_ICON: Record<SurfStage, IconName> = {
  searching: "conch",
  watching: "phone",
  reading: "newspaper",
  writing: "diary",
};

type Props = {
  phase: SurfPhase | null;
  /** 结束语的停留时长（规范：带回东西 4s，没带回 3s）。 */
  onDismiss?: () => void;
};

export function SurfStatus({ phase, onDismiss }: Props) {
  const navigate = useNavigate();
  const env = useInkEnv();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!phase) {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (phase.kind !== "browsing" && onDismiss) {
      const wait = phase.kind === "done" ? 4000 : 3000;
      const timer = window.setTimeout(() => {
        setVisible(false);
        onDismiss();
      }, wait);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase, onDismiss]);

  if (!phase || !visible) return null;
  const text =
    phase.kind === "browsing"
      ? STAGE_TEXT[phase.stage]
      : phase.kind === "done"
        ? `逛完啦，带回 ${phase.count} 样东西`
        : "这次没逛到什么，下次再去。";
  const icon: IconName = phase.kind === "browsing" ? STAGE_ICON[phase.stage] : "postcard";

  return (
    <button
      type="button"
      className="surf-slip"
      data-calm={env.calm ? "on" : "off"}
      onClick={() => navigate("/surf")}
      aria-label={`${text}，点开看她的见闻`}
    >
      <Tape color="c" w={24} h={10} angle={-2} className="surf-slip__tape" />
      <span className="surf-slip__icon" aria-hidden data-stage={phase.kind === "browsing" ? phase.stage : "done"}>
        <Icon name={icon} size={20} />
      </span>
      <span className="surf-slip__text">{text}</span>
    </button>
  );
}
