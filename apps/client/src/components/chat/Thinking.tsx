/**
 * 思考态（规范 §6.6）：取代三点 typing。
 * 一行 14px 小字每 2400ms 轮换（160ms 交叉淡入），下面一条会自己画线的墨线（InkLine draw="loop"，96 宽）。
 * 视频 / 网页进度来自现有 SSE 的 video / web 事件，换成口语版；原始 message 只进 title。
 * 20s 追加「有点长」、45s 出现 quiet「不等了」（调用现有 abort）。
 * 小字 aria-hidden，对辅助技术只读一次「她在想」。
 */
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { InkLine } from "../ink";
import { useInkEnv } from "../ink/useCalm";
import type { Progress } from "./types";
import { m } from "../../i18n";

const THOUGHTS = m.chat.thinking.thoughts;

const VIDEO: Record<string, string> = m.chat.thinking.video;

const WEB: Record<string, string> = m.chat.thinking.web;

type Props = {
  progress?: Progress;
  onGiveUp?: () => void;
};

export function Thinking({ progress, onGiveUp }: Props) {
  const calm = useInkEnv().calm;
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // 进度出现时重新计时：换阶段不该继承上一段的「有点长」。
  useEffect(() => {
    setElapsed(0);
  }, [progress?.stage, progress?.kind]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((v) => v + 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (calm) return;
    const timer = setInterval(() => setStep((v) => (v + 1) % THOUGHTS.length), 2400);
    return () => clearInterval(timer);
  }, [calm]);

  const mapped = progress ? (progress.kind === "video" ? VIDEO[progress.stage] : WEB[progress.stage]) : undefined;
  const line = mapped ?? (calm ? THOUGHTS[0] : THOUGHTS[step]);
  const tooLong = elapsed >= 20_000;
  const giveUp = elapsed >= 45_000;
  const hint = progress
    ? m.chat.thinking.longVideo
    : m.chat.thinking.slow;

  return (
    <div className="think" data-waiting={giveUp ? "long" : tooLong ? "slow" : "normal"}>
      <span className="sr-only" role="status">
        {m.chat.thinking.srLabel}
      </span>
      <p className="think__line" aria-hidden title={progress?.title ?? progress?.message}>
        {calm ? (
          line
        ) : (
          <span key={`${line}-${step}`} className="think__fade">
            {line}
          </span>
        )}
      </p>
      <InkLine id="dlg-think" size={2.4} draw={calm ? "none" : "loop"} className="think__ink" />
      {tooLong && <p className="think__hint">{hint}</p>}
      {giveUp && onGiveUp && (
        <Button variant="ghost" className="think__giveup" onClick={onGiveUp}>{m.chat.thinking.giveUp}</Button>
      )}
    </div>
  );
}
