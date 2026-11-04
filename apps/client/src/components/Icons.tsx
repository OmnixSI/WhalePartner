import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const ChatIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.4c-.5.4-1.3 0-1.3-.7V16A2.5 2.5 0 0 1 4 13.5z" /><path d="M8.5 9.5h7M8.5 12.5h4" /></svg>
);
export const DiaryIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M6 3.5h11A1.5 1.5 0 0 1 18.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z" /><path d="M8.5 3.5v17M12 8.5h3.5M12 12h3.5" /></svg>
);
export const MemoryIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z" /><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" /></svg>
);
export const SettingsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18" /></svg>
);
export const SendIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M5 12l14-7-5 14-3-6z" /><path d="M11 13l8-8" /></svg>
);

/** 品牌小标：原创鲸尾，用在导航与图标上。 */
export const TailMark = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 64 64" aria-hidden {...p}>
    <defs>
      <linearGradient id="tailg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7fe3d4" />
        <stop offset="1" stopColor="#0f8b8d" />
      </linearGradient>
    </defs>
    <path d="M32 54c0-10 1-15-8-21-4-3-8-8-9-15 6 1 11 4 14 8 1-3 2-5 3-8 1 3 2 5 3 8 3-4 8-7 14-8-1 7-5 12-9 15-9 6-8 11-8 21z" fill="url(#tailg)" />
    <circle cx="47" cy="14" r="2.6" fill="#ff8a7a" />
  </svg>
);
