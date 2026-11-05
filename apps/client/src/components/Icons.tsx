import type { SVGProps } from "react";

/** 品牌小标：原创鲸尾，单色，跟随文字颜色。 */
export const TailMark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 64 64" aria-hidden fill="currentColor" {...p}>
    <path d="M31 60c-.4-10-1.6-15-7-20C17 34 12 27 9 14c9 1 16 5 20 12 1-5 2-10 3-15 1 5 2 10 3 15 4-7 11-11 20-12-3 13-8 20-15 26-5 5-6 10-7 20z" />
  </svg>
);
