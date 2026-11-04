/** 角色占位立绘（原创）。B1 接入 three-vrm 后由 VrmStage 取代，加载失败时仍作兜底。 */
export function WhaleFigure({ className = "figure" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 440 360" role="img" aria-label="鲸汐的占位形象">
      <defs>
        <linearGradient id="wf-body" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#5fc9d8" />
          <stop offset="0.55" stopColor="#2f86c0" />
          <stop offset="1" stopColor="#1b4f8f" />
        </linearGradient>
        <linearGradient id="wf-belly" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6fbfb" />
          <stop offset="1" stopColor="#bfe6ee" />
        </linearGradient>
        <radialGradient id="wf-shine" cx="0.3" cy="0.2" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g fill="none" stroke="#e8fbff" strokeWidth="5" strokeLinecap="round" opacity="0.85">
        <path d="M150 62c-8-22 6-34 0-52" />
        <path d="M178 54c4-18 18-26 22-44" />
        <path d="M124 70c-18-10-22-26-38-32" />
      </g>
      <path d="M318 214c36-6 58-34 52-72 20 14 44 12 58-8 6 46-22 96-76 110-16 4-28-6-34-30z" fill="url(#wf-body)" />
      <path d="M52 206C50 124 128 84 220 92c86 8 132 62 122 124-10 62-82 92-158 86-72-5-130-34-132-96z" fill="url(#wf-body)" />
      <path d="M62 230c30 44 96 62 166 58 64-4 104-30 112-70-30 28-96 40-160 36-52-3-96-6-118-24z" fill="url(#wf-belly)" />
      <path d="M52 206C50 124 128 84 220 92c86 8 132 62 122 124-10 62-82 92-158 86-72-5-130-34-132-96z" fill="url(#wf-shine)" />
      <path d="M200 258c14 24 44 34 64 22-8-18-30-32-64-22z" fill="#1b4f8f" opacity="0.8" />
      <ellipse cx="118" cy="214" rx="17" ry="11" fill="#ff8a7a" opacity="0.45" />
      <g>
        <ellipse cx="118" cy="178" rx="15" ry="19" fill="#0b2540" />
        <circle cx="123" cy="170" r="6" fill="#fff" />
        <circle cx="113" cy="187" r="3" fill="#fff" opacity="0.8" />
      </g>
      <path d="M82 226c10 12 28 14 40 4" fill="none" stroke="#0b2540" strokeWidth="4" strokeLinecap="round" />
      <circle cx="378" cy="88" r="6" fill="#ff8a7a" />
      <circle cx="60" cy="120" r="9" fill="none" stroke="#e8fbff" strokeWidth="3" opacity="0.8" />
      <circle cx="40" cy="92" r="5" fill="none" stroke="#e8fbff" strokeWidth="3" opacity="0.7" />
    </svg>
  );
}
