/**
 * 角色贴纸（规范 §5.7）：一只**完全由代码绘制、纯平涂**的鲸。
 *
 * 体形按鲸来画，不是鱼：前宽后收、尾柄细、**尾叶竖直成 V**（不是横向鱼尾），
 * 背上有喷气孔（部分 mood 带水柱）、腹部留白、腮红是小圆。
 * 身体 `color-mix(in oklab, var(--accent) 55%, var(--sheet))`，肚皮 `--sheet`，
 * 描边 `--ink` 用 perfect-freehand（size 3.2，种子 17）；外圈 3px「贴纸白边」用同一轮廓
 * 描边 6px 的 `--sheet` 垫在最底层（不用 drop-shadow）。viewBox 240×200，**无任何渐变**。
 *
 * mood 分两层：`StickerMood`（对外，规范 §5.7 的 10 个 + 样品页用的 10 个同义/独立状态）
 * → `FaceKey`（真正决定五官的那 14 张脸）。10 个 mood 的差别只落在眼 / 嘴 / 眉 / 尾摆上，
 * 整体轮廓同一套点列，尾摆只是把尾叶绕尾柄转 ±6°，所以仍是一条闭合路径、没有接缝。
 */
import { flatPath, inkPath, rng, type Pt } from "../lib/ink";
import "../styles/sticker.css";

/** 对外：§5.7 的 10 个 + 样品页 /__kit 用的 10 个。 */
export type StickerMood =
  | "idle" | "happy" | "think" | "write" | "sleep" | "sorry" | "wave" | "hold" | "phone" | "paper"
  | "calm" | "sad" | "sleepy" | "curious" | "thinking" | "surprised" | "shy" | "proud" | "worried";

/** 内部：真正画出来的 14 张脸。 */
type FaceKey =
  | "calm" | "happy" | "sad" | "sleepy" | "curious" | "thinking" | "surprised" | "shy" | "proud" | "worried"
  | "write" | "hold" | "phone" | "paper";

const FACE: Record<StickerMood, FaceKey> = {
  idle: "calm",
  calm: "calm",
  happy: "happy",
  think: "thinking",
  thinking: "thinking",
  sleep: "sleepy",
  sleepy: "sleepy",
  sorry: "worried",
  worried: "worried",
  sad: "sad",
  curious: "curious",
  surprised: "surprised",
  shy: "shy",
  proud: "proud",
  write: "write",
  hold: "hold",
  phone: "phone",
  paper: "paper",
  wave: "happy", // 举手指的是「同一张笑脸 + 一只举起的鳍」
};

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

/* ------------------------------------------------------------------ *
 * 轮廓：一条闭合路径 = 头背 + 尾叶（可摆） + 腹侧
 * ------------------------------------------------------------------ */

/** 描边种子固定 17（规范 §5.7）。 */
const SEED = 17;
function seeded(points: Pt[], amount = 0.9): Pt[] {
  const r = rng(SEED);
  return points.map(([x, y]) => [x + (r() - 0.5) * 2 * amount, y + (r() - 0.5) * 2 * amount]);
}

/** 头 → 背 → 尾柄上缘：前宽后收（长宽比 ≈1.5），这是「鲸」而不是「圆鱼」的第一条。 */
const FRONT_TOP: Pt[] = [
  [24, 102], [26, 86], [36, 72], [52, 62], [72, 55], [94, 52], [116, 52], [136, 55], [152, 63], [166, 76], [178, 90], [188, 100],
];

/**
 * 尾叶：竖直的 V（不是横向鱼尾）。上叶尖在上、下叶尖在下，中间从右往左凹一个缺；
 * 两片是圆头的桨而不是尖刀，所以读作鲸尾而不是燕尾。
 */
const FLUKE: Pt[] = [
  [188, 98], [200, 78], [210, 70], [216, 76],
  [214, 90], [206, 100],
  [200, 106],
  [200, 110], [206, 116], [214, 126], [216, 140],
  [210, 146], [200, 138], [188, 118],
];

/** 尾柄下缘 → 腹线 → 下颌。 */
const BODY_BOTTOM: Pt[] = [
  [188, 116], [184, 128], [174, 138], [158, 147], [138, 152], [112, 154], [90, 152], [70, 146], [54, 138], [40, 126], [28, 112],
];

/** 尾摆轴心（尾柄）。 */
const PIVOT: Pt = [188, 108];

function rotate([x, y]: Pt, deg: number): Pt {
  if (!deg) return [x, y];
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - PIVOT[0];
  const dy = y - PIVOT[1];
  return [PIVOT[0] + dx * c - dy * s, PIVOT[1] + dx * s + dy * c];
}

/** 同一副轮廓，只有尾叶按 mood 摆一点。 */
function silhouette(sway: number): Pt[] {
  return [...FRONT_TOP, ...FLUKE.map((p) => rotate(p, sway)), ...BODY_BOTTOM];
}

/** 腹部留白：沿下缘的一条宽带（不是细线，否则会被读成一张嘴）。 */
const BELLY_PTS: Pt[] = [
  [48, 128], [60, 140], [84, 149], [112, 151], [138, 146], [154, 137],
  [140, 126], [116, 134], [88, 137], [66, 130], [56, 122],
];
const BELLY_FLAT = flatPath("whale:belly", BELLY_PTS);

/** 胸鳍：贴在腹侧的短桨（鲸的第二条识别特征）。 */
const FLIPPER: Pt[] = [[66, 126], [88, 134], [96, 146], [78, 150], [64, 140]];
const FLIPPER_FLAT = flatPath("whale:flipper", FLIPPER);
const FLIPPER_INK = inkPath("whale:flipper", seeded(FLIPPER, 0.5), 2.4);

/** 喷气孔：背上那一小道，永远画（鲸的第三条识别特征）。 */
const BLOWHOLE = "M118,56 q6,5 12,0";

/* ------------------------------------------------------------------ *
 * 五官表：眼 / 嘴 / 眉 / 腮红 / 尾摆 / 头顶的记号
 * ------------------------------------------------------------------ */

type Eyes =
  | { kind: "dot"; look?: Pt; r?: number }
  | { kind: "happy" }
  | { kind: "closed" }
  | { kind: "wide"; look?: Pt }
  | { kind: "line" };
type Mouth = "arc" | "open" | "o" | "frown" | "flat" | "tiny";
type Brows = "none" | "one-up" | "worried";
type Mark = "none" | "sweat" | "z" | "squiggle" | "splash";

type FaceSpec = {
  eyes: Eyes;
  mouth: Mouth;
  brows: Brows;
  blush: "small" | "big";
  /** 尾摆角度：负=尾叶朝上翘，正=尾叶垂下来 */
  sway: number;
  spout?: boolean;
  mark?: Mark;
};

const FACES: Record<FaceKey, FaceSpec> = {
  // 默认：两个墨点 + 小弧嘴，尾巴平放
  calm: { eyes: { kind: "dot" }, mouth: "arc", brows: "none", blush: "small", sway: 0 },
  happy: { eyes: { kind: "happy" }, mouth: "open", brows: "none", blush: "small", sway: -5, mark: "splash" },
  // 低头看本子：眼睛朝下
  write: { eyes: { kind: "dot", look: [0, 2] }, mouth: "flat", brows: "none", blush: "small", sway: 2 },
  sleepy: { eyes: { kind: "closed" }, mouth: "tiny", brows: "none", blush: "small", sway: 3, mark: "z" },
  sad: { eyes: { kind: "dot", look: [0, 1.5] }, mouth: "frown", brows: "worried", blush: "small", sway: 5 },
  worried: { eyes: { kind: "dot", look: [0, 1], }, mouth: "frown", brows: "worried", blush: "small", sway: 4, mark: "sweat" },
  curious: { eyes: { kind: "dot", look: [1.6, -2] }, mouth: "o", brows: "one-up", blush: "small", sway: -3, spout: true },
  thinking: { eyes: { kind: "dot", look: [-1.6, -2] }, mouth: "flat", brows: "one-up", blush: "small", sway: 0, mark: "squiggle" },
  surprised: { eyes: { kind: "wide" }, mouth: "o", brows: "none", blush: "small", sway: -4 },
  shy: { eyes: { kind: "dot", look: [-1.2, 2] }, mouth: "tiny", brows: "none", blush: "big", sway: 2 },
  proud: { eyes: { kind: "happy" }, mouth: "arc", brows: "none", blush: "small", sway: -6, spout: true },
  hold: { eyes: { kind: "dot", look: [-1.6, 0.6] }, mouth: "tiny", brows: "none", blush: "small", sway: 1 },
  phone: { eyes: { kind: "dot", look: [0, 2] }, mouth: "tiny", brows: "none", blush: "small", sway: 1 },
  paper: { eyes: { kind: "dot", look: [1.6, 1] }, mouth: "tiny", brows: "none", blush: "small", sway: -1 },
};

/* ------------------------------------------------------------------ *
 * 小零件
 * ------------------------------------------------------------------ */

const Dot = ({ cx, cy, r = 5 }: { cx: number; cy: number; r?: number }) => <circle cx={cx} cy={cy} r={r} fill={INK} />;

const Line = ({ d, width = 3.2 }: { d: string; width?: number }) => (
  <path d={d} fill="none" stroke={INK} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
);

const Glint = ({ cx, cy, r = 1.8 }: { cx: number; cy: number; r?: number }) => <circle cx={cx} cy={cy} r={r} fill={SHEET} />;

/** 小手/鳍：握东西的几只手都用它。 */
const Fin = ({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) => (
  <g transform={`translate(${x} ${y})${flip ? " scale(-1 1)" : ""}`}>
    <path d="M0,0 C6,-5 15,-5 19,2 C14,9 5,9 0,4 Z" fill={BODY} />
    <path d="M0,0 C6,-5 15,-5 19,2 C14,9 5,9 0,4" fill="none" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
  </g>
);

/* ------------------------------------------------------------------ *
 * 表情
 * ------------------------------------------------------------------ */

const EYE_L = { x: 70, y: 96 };
const EYE_R = { x: 100, y: 92 };

function Eyes({ shape }: { shape: Eyes }) {
  switch (shape.kind) {
    case "happy":
      return (
        <g className="whale-sticker__eyes">
          <Line d={`M${EYE_L.x - 8},${EYE_L.y + 4} q8,-11 16,0`} />
          <Line d={`M${EYE_R.x - 8},${EYE_R.y + 4} q8,-11 16,0`} />
        </g>
      );
    case "closed":
      return (
        <g className="whale-sticker__eyes">
          <Line d={`M${EYE_L.x - 7},${EYE_L.y - 1} q7,7 14,0`} />
          <Line d={`M${EYE_R.x - 7},${EYE_R.y - 1} q7,7 14,0`} />
        </g>
      );
    case "line":
      return (
        <g className="whale-sticker__eyes">
          <Line d={`M${EYE_L.x - 7},${EYE_L.y} h14`} />
          <Line d={`M${EYE_R.x - 7},${EYE_R.y} h14`} />
        </g>
      );
    case "wide": {
      const [dx, dy] = shape.look ?? [0, 0];
      return (
        <g className="whale-sticker__eyes">
          <Dot cx={EYE_L.x + dx} cy={EYE_L.y + dy} r={7} />
          <Glint cx={EYE_L.x + dx - 2} cy={EYE_L.y + dy - 2.5} r={2.4} />
          <Dot cx={EYE_R.x + dx} cy={EYE_R.y + dy} r={7} />
          <Glint cx={EYE_R.x + dx - 2} cy={EYE_R.y + dy - 2.5} r={2.4} />
        </g>
      );
    }
    default: {
      const [dx, dy] = shape.look ?? [0, 0];
      const r = shape.r ?? 5;
      return (
        <g className="whale-sticker__eyes">
          <Dot cx={EYE_L.x + dx} cy={EYE_L.y + dy} r={r} />
          <Dot cx={EYE_R.x + dx} cy={EYE_R.y + dy} r={r} />
        </g>
      );
    }
  }
}

function Mouth({ shape }: { shape: Mouth }) {
  switch (shape) {
    case "open":
      return <path d="M52,116 h24 a12,9 0 0 1 -24,0 Z" fill={INK} />;
    case "o":
      return <ellipse cx={64} cy={121} rx={5} ry={6} fill={INK} />;
    case "frown":
      return <Line d={`M52,126 q12,-9 24,0`} width={2.8} />;
    case "flat":
      return <Line d="M52,122 h22" width={2.8} />;
    case "tiny":
      return <Line d="M56,122 q7,5 14,0" width={2.6} />;
    default:
      return <Line d="M52,120 q12,9 24,1" />;
  }
}

function Brows({ shape }: { shape: Brows }) {
  if (shape === "one-up") return <Line d="M60,80 q11,-8 21,-3" width={2.6} />;
  if (shape === "worried")
    return (
      <>
        <Line d="M78,80 L62,87" width={2.6} />
        <Line d="M96,79 L110,86" width={2.6} />
      </>
    );
  return null;
}

/** 头顶的记号：汗、Z、思考的墨线、水花。 */
function Mark({ shape }: { shape: Mark }) {
  switch (shape) {
    case "sweat":
      return <path d="M128,70 q7,10 0,14 q-7,-4 0,-14 Z" fill={SHEET} stroke={INK} strokeWidth={2} strokeLinejoin="round" />;
    case "z":
      return (
        <g>
          <Line d="M124,38 L138,38 L124,52 L138,52" width={2.6} />
          <Line d="M146,22 L158,22 L146,34 L158,34" width={2.2} />
        </g>
      );
    case "squiggle":
      return <Line d="M116,34 q8,-11 16,0 q8,11 16,0" width={2.6} />;
    case "splash":
      return (
        <g>
          <Line d="M42,40 q7,-10 14,0" width={2.6} />
          <Line d="M150,26 q6,-9 12,0" width={2.4} />
        </g>
      );
    default:
      return null;
  }
}

/** 喷气孔的水柱（可选，规范 §5.7）。 */
function Spout() {
  return (
    <g>
      <Line d="M122,50 q4,-13 -2,-22" width={2.6} />
      <Line d="M128,52 q10,-10 9,-20" width={2.4} />
      <Line d="M116,52 q-9,-9 -8,-18" width={2.4} />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * 手里拿的东西
 * ------------------------------------------------------------------ */

function Props({ face }: { face: FaceKey }) {
  return (
    <>
      {face === "write" && (
        <g>
          <path d="M144,140 L182,140 L182,170 L144,170 Z" fill={SHEET} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
          <Line d="M150,150 L170,150" width={2} />
          <Line d="M150,159 L164,159" width={2} />
          <path d="M156,134 L172,114 L180,120 L164,140 Z" fill={BLUSH} stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
          <Fin x={126} y={146} />
        </g>
      )}
      {face === "hold" && (
        <g>
          <path d="M112,126 L126,126 L126,132 C134,138 134,144 134,152 C134,166 126,172 119,172 C112,172 104,166 104,152 C104,144 104,138 112,132 Z" fill={SHEET} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
          <Line d="M111,132 L127,132" width={2} />
          <path d="M112,154 L119,146 L125,156 Z" fill={SHEET} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
          <Fin x={94} y={144} />
          <Fin x={176} y={144} flip />
        </g>
      )}
      {face === "phone" && (
        <g>
          <path d="M126,134 L154,134 C157,134 158,136 158,139 L158,174 C158,177 156,179 153,179 L127,179 C124,179 122,177 122,174 L122,139 C122,136 123,134 126,134 Z" fill={SHEET} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
          <g className="whale-sticker__ph">
            <Line d="M130,147 L150,147" width={2.2} />
            <Line d="M130,156 L150,156" width={2.2} />
            <Line d="M130,165 L150,165" width={2.2} />
          </g>
          <Fin x={100} y={148} />
          <Fin x={184} y={148} flip />
        </g>
      )}
      {face === "paper" && (
        <g>
          <path d="M106,120 L172,120 L172,160 L106,160 Z" fill={SHEET} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
          <Line d="M112,130 L142,130" width={2} />
          <Line d="M112,140 L166,140" width={2} />
          <Line d="M112,150 L152,150" width={2} />
          <g className="whale-sticker__pen">
            <circle cx={156} cy={146} r={2.4} fill={INK} />
          </g>
          <Fin x={94} y={142} />
          <Fin x={180} y={142} flip />
        </g>
      )}
    </>
  );
}

/** 举手：鳍要从身体背后长出来，所以单独一层，画在身体之前。 */
function Behind({ wave }: { wave: boolean }) {
  if (!wave) return null;
  return <path d="M32,84 C16,60 18,42 30,38 C44,48 46,70 44,82 Z" fill={BODY} stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />;
}

/* ------------------------------------------------------------------ *
 * 主体
 * ------------------------------------------------------------------ */

export function WhaleSticker({ mood = "idle", className = "", label }: Props) {
  const face = FACES[FACE[mood] ?? "calm"];
  const wave = mood === "wave";
  const pts = silhouette(face.sway);
  // 每个尾摆角度一条路径，模块级缓存；同一 (mood, 主题) 永远是同一条抖动。
  const flat = flatPath(`whale:${face.sway}`, pts);
  const ink = inkPath(`whale:${face.sway}`, seeded(pts), 3.2);
  const cls = `whale-sticker ${mood === "idle" || mood === "calm" ? "whale-sticker--breath" : ""} ${className}`.trim();
  const blushR = face.blush === "big" ? 7.5 : 5.5;

  return (
    <svg
      className={cls}
      viewBox="0 0 240 200"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {/* 背后：举起的鳍 */}
      <Behind wave={wave} />
      {/* 贴纸白边：同一轮廓描边 6px 的 --sheet */}
      <path d={ink} fill={SHEET} stroke={SHEET} strokeWidth={6} strokeLinejoin="round" />
      {/* 平涂：身体 → 腹部留白 → 腮红小圆 */}
      <path d={flat} fill={BODY} />
      <path d={BELLY_FLAT} fill={SHEET} />
      <path d={FLIPPER_FLAT} fill={BODY} />
      <path d={FLIPPER_INK} fill={INK} />
      <circle cx={54} cy={116} r={blushR} fill={BLUSH} />
      <circle cx={114} cy={110} r={blushR - 0.8} fill={BLUSH} />
      {/* 墨线轮廓压在最上层 */}
      <path d={ink} fill={INK} />
      <Line d={BLOWHOLE} width={2.4} />
      {/* 喷气孔 + 水柱 */}
      {face.spout && <Spout />}
      <Mark shape={face.mark ?? "none"} />
      {/* 五官 */}
      <Brows shape={face.brows} />
      <Eyes shape={face.eyes} />
      <Mouth shape={face.mouth} />
      {/* 手里的东西 */}
      <Props face={FACE[mood] ?? "calm"} />
    </svg>
  );
}
