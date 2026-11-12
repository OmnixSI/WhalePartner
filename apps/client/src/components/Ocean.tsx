import { useLocation } from "react-router-dom";

const WAVE = "M0 70 C120 40 240 100 360 70 S600 40 720 70 S960 100 1080 70 S1320 40 1440 70 L1440 120 L0 120 Z";

/** 背景：首页是一条海平线、两层平涂的浪；读写类的页面只留纸。 */
export function Ocean() {
  const home = useLocation().pathname === "/";
  return (
    <div className="ocean" aria-hidden data-ambient="">
      {home && (
        <>
          <svg className="ocean__wave ocean__wave--b" viewBox="0 0 1440 120" preserveAspectRatio="none"><path d={WAVE} /></svg>
          <svg className="ocean__wave ocean__wave--a" viewBox="0 0 1440 120" preserveAspectRatio="none"><path d={WAVE} /></svg>
        </>
      )}
    </div>
  );
}
