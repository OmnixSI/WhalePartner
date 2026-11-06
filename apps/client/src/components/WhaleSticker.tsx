/**
 * 角色贴纸（规范 §5.7）：一只**完全由代码绘制、纯平涂**的鲸。
 *
 * 取代 `WhaleFigure.tsx` 的渐变鲸：
 * - 身体 `color-mix(in oklab, var(--accent) 55%, var(--sheet))`，肚皮 `--sheet`，
 *   腮红 `--coral-soft`（装饰），描边 `--ink` 用 perfect-freehand（size 3.2，种子 17）；
 * - 外圈 3px「贴纸白边」用**同一轮廓**描边 6px 的 `--sheet` 放在最底层（不用 drop-shadow）；
 * - viewBox `0 0 240 200`，**不含任何 linearGradient / radialGradient**。
 *
 * 10 个 mood 是同一套状态，四个角色共用（颜色跟着当前角色 accent 走）：
 * idle / happy / think / write / sleep / sorry / wave / hold / phone / paper。
 * 动效只有 idle 的呼吸（scale 1 → 1.015，--breath）与眨眼；calm 下两者都停。
 */
import { flatPath, inkPath, rng, type Pt } from "../lib/ink";
import "../styles/sticker.css";

export type StickerMood = "idle" | "happy" | "think" | "write" | "sleep" | "sorry" | "wave" | "hold" | "phone" | "paper";

type Props = {
  mood?: StickerMood;
  className?: string;
  /** 不传就是纯装饰（aria-hidden）；传了就作为 img 的描述 */
  label?: string;
};

const INK = "var(--ink)";
const SHEET = "var(--sheet)";
const BODY = "color-mix(in oklab, var(--accent) 55%, var(--sheet))";
const BLUSH = "var(--coral-soft)";

/** 描边种子固定 17：先按种子给骨架 ±0.9 抖动，再交给 perfect-freehand。 */
const SEED = 17;
function seeded(points: Pt[], amount = 0.9): Pt[] {
  const r = rng(SEED);
  return points.map(([x, y]) => [x + (r() - 0.5) * 2 * amount, y + (r() - 0.5) * 2 * amount]);
}

/** 身体剪影：头在左，尾叶在右，尾根处有个内凹的口。 */
const BODY_PTS: Pt[] = [
  [46, 92], [56, 72], [76, 60], [102, 53], [130, 52], [156, 57], [176, 68], [190, 84],
  [200, 74], [216, 62], [230, 58], [226, 74], [214, 88], [206, 100],
  [216, 112], [228, 126], [232, 144], [216, 138], [200, 124],
  [196, 140], [184, 154], [162, 164], [132, 170], [100, 168], [72, 160], [50, 146], [38, 128], [34, 108],
];

/** 肚皮：只占下缘一条窄带，并且**不描边**——描边会把它画成一张笑嘴。 */
const BELLY_PTS: Pt[] = [
  [48, 144], [64, 157], [92, 166], [128, 167], [154, 160], [170, 148], [148, 157], [118, 161], [86, 159], [62, 153],
];

// 平涂色块与墨线轮廓在模块级算好并缓存：重渲染、切 mood 都不重算。
const BODY_FLAT = flatPath("whale:body", BODY_PTS);
const BELLY_FLAT = flatPath("whale:belly", BELLY_PTS);
const BODY_INK = inkPath("whale:body", seeded(BODY_PTS), 3.2);

/* ---------------- 小零件 ---------------- */

const Dot = ({ cx, cy, r = 5.5 }: { cx: number; cy: number; r?: number }) => <circle cx={cx} cy={cy} r={r} fill={INK} />;

const Line = ({ d, width = 3.2 }: { d: string; width?: number }) => (
  <path d={d} fill="none" stroke={INK} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
);

/** 眼里的高光：朝哪看，高光就偏到那边。 */
const Glint = ({ cx, cy, r = 1.9 }: { cx: number; cy: number; r?: number }) => <circle cx={cx} cy={cy} r={r} fill={SHEET} />;

/** 鳍：一个平涂小色块 + 墨线，握东西的两只都用它。 */
const Fin = ({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) => (
  <g transform={`translate(${x} ${y})${flip ? " scale(-1 1)" : ""}`}>
    <path d="M0,0 C6,-6 16,-6 20,2 C15,10 5,10 0,4 Z" fill={BODY} />
    <path d="M0,0 C6,-6 16,-6 20,2 C15,10 5,10 0,4" fill="none" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
  </g>
);

/* ---------------- 画在身体后面的道具 ---------------- */

/** 举手的鳍要从身体背后长出来：先画它，再画身体，最后身体墨线压住鳍根。 */
function Behind({ mood }: { mood: StickerMood }) {
  if (mood !== "wave") return null;
  return <path d="M150,70 C156,46 170,32 181,36 C185,48 172,64 162,72 Z" fill={BODY} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />;
}

/* ---------------- 表情 ---------------- */

function Face({ mood }: { mood: StickerMood }) {
  switch (mood) {
    case "happy":
    case "wave":
      return (
        <>
          <g className="whale-sticker__eyes">
            <Line d="M80,102 q7,-9 14,0" />
            <Line d="M110,100 q7,-9 14,0" />
          </g>
          {mood === "wave" ? <Line d="M100,120 q9,8 18,0" /> : <path d="M99,117 h20 a10,9 0 0 1 -20,0 Z" fill={INK} />}
        </>
      );
    case "sleep":
      return (
        <>
          <Line d="M80,102 q7,6 14,0" />
          <Line d="M110,100 q7,6 14,0" />
          <Line d="M101,122 q8,4 16,0" width={2.8} />
        </>
      );
    case "sorry":
      return (
        <>
          <g className="whale-sticker__eyes">
            <Dot cx={88} cy={102} />
            <Dot cx={118} cy={100} />
          </g>
          <Line d="M94,86 L80,93" width={2.8} />
          <Line d="M120,84 L134,91" width={2.8} />
          <Line d="M100,126 q9,-7 18,0" width={2.8} />
          {/* 一滴汗 */}
          <path d="M150,80 q7,10 0,14 q-7,-4 0,-14 Z" fill={SHEET} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        </>
      );
    case "think":
      return (
        <>
          <g className="whale-sticker__eyes">
            <Dot cx={87} cy={98} r={6} />
            <Glint cx={84.5} cy={95.5} />
            <Dot cx={117} cy={96} r={6} />
            <Glint cx={114.5} cy={93.5} />
          </g>
          <Line d="M79,84 q10,-7 20,-3" width={2.8} />
          <Line d="M104,122 q8,4 15,-1" width={2.8} />
        </>
      );
    case "write":
      return (
        <>
          <g className="whale-sticker__eyes">
            <Dot cx={88} cy={103} />
            <Glint cx={86} cy={100.5} />
            <Dot cx={118} cy={101} />
            <Glint cx={116} cy={98.5} />
          </g>
          <Line d="M101,124 q9,4 17,0" width={2.8} />
        </>
      );
    case "hold":
      return (
        <>
          <g className="whale-sticker__eyes">
            <Dot cx={85} cy={101} />
            <Glint cx={83} cy={99} />
            <Dot cx={115} cy={99} />
            <Glint cx={113} cy={97} />
          </g>
          <Line d="M101,123 q8,6 15,0" width={2.8} />
        </>
      );
    case "phone":
    case "paper":
      return (
        <>
          <g className="whale-sticker__eyes">
            <Dot cx={88} cy={102} r={5} />
            <Glint cx={88} cy={99.5} />
            <Dot cx={116} cy={101} r={5} />
            <Glint cx={116} cy={98.5} />
          </g>
          <Line d="M102,123 q8,5 15,0" width={2.8} />
        </>
      );
    default: // idle
      return (
        <>
          <g className="whale-sticker__eyes">
            <Dot cx={88} cy={100} />
            <Dot cx={118} cy={98} />
          </g>
          <Line d="M100,121 q9,7 18,0" />
        </>
      );
  }
}

/* ---------------- 道具 / 举手 ---------------- */

function Props({ mood }: { mood: StickerMood }) {
  switch (mood) {
    case "happy":
      // 两颗小水花
      return (
        <g>
          <Line d="M62,46 q7,-10 14,0" width={2.6} />
          <Line d="M146,32 q6,-9 12,0" width={2.4} />
        </g>
      );
    case "think":
      // 头上一笔自画的墨线
      return <Line d="M144,40 q8,-11 16,0 q8,11 16,0" width={2.6} />;
    case "write":
      // 鳍握笔 + 小本子
      return (
        <g>
          <path d="M140,148 L178,148 L178,176 L140,176 Z" fill={SHEET} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
          <Line d="M146,158 L166,158" width={2} />
          <Line d="M146,166 L160,166" width={2} />
          <path d="M156,142 L172,126 L180,132 L164,148 Z" fill={BLUSH} stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
          <Fin x={120} y={150} />
        </g>
      );
    case "sleep": {
      // 头上两笔「Z」
      return (
        <g>
          <Line d="M144,44 L158,44 L144,58 L158,58" width={2.6} />
          <Line d="M166,26 L178,26 L166,38 L178,38" width={2.2} />
        </g>
      );
    }
    case "wave":
      return null; // 举起的鳍画在身体后面，见 <Behind/>
    case "hold":
      // 抱着一个小玻璃瓶
      return (
        <g>
          <path d="M114,132 L128,132 L128,138 C136,144 136,150 136,158 C136,172 128,178 121,178 C114,178 106,172 106,158 C106,150 106,144 114,138 Z" fill={SHEET} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
          <Line d="M112,138 L130,138" width={2} />
          <path d="M114,160 L122,152 L128,162 Z" fill={SHEET} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
          <Fin x={92} y={150} />
          <Fin x={176} y={150} flip />
        </g>
      );
    case "phone":
      // 双鳍捧手机，屏幕三道横线依次点亮
      return (
        <g>
          <path d="M118,140 L146,140 C149,140 150,142 150,145 L150,180 C150,183 148,185 145,185 L119,185 C116,185 114,183 114,180 L114,145 C114,142 115,140 118,140 Z" fill={SHEET} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
          <g className="whale-sticker__ph">
            <Line d="M122,154 L142,154" width={2.2} />
            <Line d="M122,163 L142,163" width={2.2} />
            <Line d="M122,172 L142,172" width={2.2} />
          </g>
          <Fin x={90} y={156} />
          <Fin x={178} y={156} flip />
        </g>
      );
    case "paper":
      // 双鳍展开一张小报纸，笔尖在上面移动
      return (
        <g>
          <path d="M104,126 L170,126 L170,166 L104,166 Z" fill={SHEET} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
          <Line d="M110,136 L140,136" width={2} />
          <Line d="M110,146 L164,146" width={2} />
          <Line d="M110,156 L150,156" width={2} />
          <g className="whale-sticker__pen">
            <circle cx={152} cy={152} r={2.4} fill={INK} />
          </g>
          <Fin x={92} y={150} />
          <Fin x={176} y={150} flip />
        </g>
      );
    case "sorry":
      return null;
    default:
      return null;
  }
}

/* ---------------- 主体 ---------------- */

export function WhaleSticker({ mood = "idle", className = "", label }: Props) {
  const cls = `whale-sticker ${mood === "idle" ? "whale-sticker--breath" : ""} ${className}`.trim();
  return (
    <svg
      className={cls}
      viewBox="0 0 240 200"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {/* 贴纸白边：同一轮廓描边 6px 的 --sheet，放最底层 */}
      <path d={BODY_INK} fill={SHEET} stroke={SHEET} strokeWidth={6} strokeLinejoin="round" />
      <Behind mood={mood} />
      {/* 平涂：身体 → 肚皮 → 鳍 → 腮红 */}
      <path d={BODY_FLAT} fill={BODY} />
      <path d={BELLY_FLAT} fill={SHEET} />
      <ellipse cx={66} cy={120} rx={10} ry={5.5} fill={BLUSH} />
      <ellipse cx={140} cy={116} rx={9} ry={5} fill={BLUSH} />
      {/* 墨线轮廓在最上层，盖住平涂色块的毛边 */}
      <path d={BODY_INK} fill={INK} />
      <Face mood={mood} />
      <Props mood={mood} />
    </svg>
  );
}
