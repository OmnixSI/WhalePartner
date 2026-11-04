const BUBBLES = [
  { x: "6%", s: 14, d: 17, delay: 0 }, { x: "14%", s: 8, d: 13, delay: 4 }, { x: "23%", s: 20, d: 21, delay: 9 },
  { x: "34%", s: 10, d: 15, delay: 2 }, { x: "47%", s: 16, d: 19, delay: 7 }, { x: "58%", s: 7, d: 12, delay: 11 },
  { x: "66%", s: 22, d: 23, delay: 3 }, { x: "76%", s: 11, d: 16, delay: 6 }, { x: "86%", s: 15, d: 18, delay: 1 },
  { x: "93%", s: 9, d: 14, delay: 10 },
];

const WAVE = "M0 60 C120 20 240 100 360 60 S600 20 720 60 S960 100 1080 60 S1320 20 1440 60 L1440 120 L0 120 Z";

export function Ocean() {
  return (
    <div className="ocean" aria-hidden>
      <div className="ocean__rays" />
      {BUBBLES.map((b, i) => (
        <span key={i} className="bubble" style={{ "--x": b.x, "--s": `${b.s}px`, "--d": `${b.d}s`, "--delay": `-${b.delay}s` } as React.CSSProperties} />
      ))}
      <svg className="ocean__wave ocean__wave--b" viewBox="0 0 1440 120" preserveAspectRatio="none"><path d={WAVE} /></svg>
      <svg className="ocean__wave ocean__wave--a" viewBox="0 0 1440 120" preserveAspectRatio="none"><path d={WAVE} /></svg>
    </div>
  );
}
