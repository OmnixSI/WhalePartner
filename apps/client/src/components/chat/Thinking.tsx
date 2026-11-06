/**
 * 思考态（规范 §6.6）：取代三点 typing。
 * 一行 14px 小字每 2400ms 轮换（160ms 交叉淡入），下面一条会自己画线的墨线（InkLine draw="loop"，96 宽）。
 * 视频 / 网页进度来自现有 SSE 的 video / web 事件，换成口语版；原始 message 只进 title。
 * 20s 追加「有点长」、45s 出现 quiet「不等了」（调用现有 abort）。
 * 小字 aria-hidden，对辅助技术只读一次「她在想」。
 */
import { useEffect, useState } from "react";
import { InkLine } from "../ink";
import { useInkEnv } from "../ink/useCalm";
import type { Progress } from "./types";

const THOUGHTS = ["我想想哦…", "翻翻小本子…", "在找那句话…", "马上就好。"];

const VIDEO: Record<string, string> = {
  reading: "先打开这个视频看看…",
  watching: "在看里面的画面和字幕…",
  thinking: "看完了，在想怎么跟你讲。",
  failed: "这个视频我没看成。",
};

const WEB: Record<string, string> = {
  reading: "在读这个网页…",
  summarizing: "读完了，在整理。",
  failed: "这个网页打不开。",
};

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
    ? "这个视频有点长，我再看一会儿，你可以先去逛逛别的页面。"
    : "她想得有点久，再等等，或者先去别的页面。";

  return (
    <div className="think" data-waiting={giveUp ? "long" : tooLong ? "slow" : "normal"}>
      <span className="sr-only" role="status">
        她在想
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
        <button type="button" className="btn btn--quiet think__giveup" onClick={onGiveUp}>
          不等了
        </button>
      )}
    </div>
  );
}
