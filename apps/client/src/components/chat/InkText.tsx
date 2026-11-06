/**
 * 「墨水渗入」的逐字流式（规范 §6.8）：每个 SSE delta 包成一段 `<span class="ink-in">`，
 * 只动画新增的 span，已有内容不重绘；一次 delta 超过 24 字时按 6 字切块、级联 28ms（总 ≤280ms）。
 * 完成后（merged）合并成一个文本节点，避免 DOM 越滚越大。
 * 打字机光标、逐字定时器、三点动画都不要。
 */
import { Fragment } from "react";

type Props = {
  chunks: string[];
  merged: boolean;
};

type Piece = { text: string; delay: number };

/** 大块 delta 切成小片，延迟封顶 280ms（规范 §6.8）。 */
function splitChunk(chunk: string): Piece[] {
  if (chunk.length <= 24) return [{ text: chunk, delay: 0 }];
  const pieces: Piece[] = [];
  for (let i = 0; i < chunk.length; i += 6) {
    pieces.push({ text: chunk.slice(i, i + 6), delay: Math.min(280, pieces.length * 28) });
  }
  return pieces;
}

export function InkText({ chunks, merged }: Props) {
  if (merged) return <>{chunks.join("")}</>;
  return (
    <>
      {chunks.map((chunk, ci) => (
        <Fragment key={ci}>
          {splitChunk(chunk).map((piece, pi) => (
            <span key={pi} className="ink-in" style={{ animationDelay: `${piece.delay}ms` }}>
              {piece.text}
            </span>
          ))}
        </Fragment>
      ))}
    </>
  );
}
