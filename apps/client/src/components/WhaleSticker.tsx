/**
 * 角色贴纸（规范 §5.7）：一只**完全由代码绘制、纯平涂**的鲸。
 *
 * 画板 `0 0 96 96`（整只都在框内，尾叶不越界），按鲸的解剖画，不是鱼：
 * - 头圆钝、占体长 ~45%，向尾柄**平滑收窄到很细**（尾柄只有 8 高）；
 * - 尾叶是**水平的一片**：3/4 视角下上瓣给背面、下瓣给腹面，两瓣都肥、中间一个深缺，
 *   尾柄又细，所以读作鲸尾；不是鱼那种薄而对称的竖鳍；
 * - 背鳍：没有。头顶偏后有一个**月牙形喷气孔**；happy / curious / proud 另画一小股水柱；
 * - 胸鳍：**只有一片**，贴在腹侧偏前；
 * - 腹部：一条浅色宽带从下巴一直拉到尾柄，边缘是手绘的不规则起伏；
 * - 外圈「贴纸白边」= 同一轮廓描边 8 的 `--sheet` 垫在最底层（不用 drop-shadow），墨线 size 2.8。
 *
 * **10 个 mood 共用同一条轮廓**：差别只有眼 / 嘴 / 眉 / 尾摆角度 / 水柱。
 * 尾摆 = 把尾叶绕尾柄转 ±5° 再拼回同一条闭合路径，所以路径本身仍是一条、没有接缝。
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
  wave: "happy", // 举手指的是「同一张笑脸 + 水面下抬起的前鳍」
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
 * 轮廓：头背 + 尾叶（可摆） + 腹线，一条闭合路径
 * ------------------------------------------------------------------ */

const SEED = 17;
const INK_SIZE = 2.8;
/** 白边：比墨线宽 8，露出约 3 的一圈纸色（规范 §5.7 的「3px 贴纸白边」）。 */
const WHITE = 8;

function seeded(points: Pt[], amount = 0.6): Pt[] {
  const r = rng(SEED);
  return points.map(([x, y]) => [x + (r() - 0.5) * 2 * amount, y + (r() - 0.5) * 2 * amount]);
}

/**
 * 头圆钝、占体长 ~40%，背线平滑下压到很细的尾柄（x≈70，只有 12 高）。
 * 整只 5..91 × 23..70，长宽比 ≈1.9——鱼是圆的，鲸是长的。
 */
const FRONT_TOP: Pt[] = [
  [5, 50], [6, 41], [10, 33], [17, 27], [26, 24], [37, 23], [47, 25], [56, 29], [63, 35], [68, 41], [70, 44],
];

/**
 * 尾叶：水平的一片（3/4 视角：上瓣给出背面、下瓣给出腹面），两瓣都很肥、中间一个深缺。
 * 尾柄只有 12 高，所以它读作「鲸的尾叶」而不是鱼的竖鳍。
 */
const FLUKE: Pt[] = [
  [70, 44], [78, 38], [86, 34], [90, 40], [84, 46], [80, 49],
  [80, 53], [84, 56], [90, 62], [86, 68], [78, 64], [70, 56],
];

/** 腹线：从尾柄下缘兜回下巴。 */
const BODY_BOTTOM: Pt[] = [
  [70, 56], [67, 60], [62, 64], [55, 67], [46, 69], [36, 70], [26, 69], [17, 66], [11, 61], [7, 56],
];

/** 尾摆轴心（尾柄中点）。 */
const PIVOT: Pt = [70, 50];

function rotate([x, y]: Pt, deg: number): Pt {
  if (!deg) return [x, y];
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - PIVOT[0];
  const dy = y - PIVOT[1];
  return [PIVOT[0] + dx * c - dy * s, PIVOT[1] + dx * s + dy * c];
}

/** 同一副轮廓；只有尾叶按 mood 摆一点。 */
function silhouette(sway: number): Pt[] {
  return [...FRONT_TOP, ...FLUKE.map((p) => rotate(p, sway)), ...BODY_BOTTOM];
}

/** 腹部：下巴 → 尾柄的一条浅色宽带，边缘带手绘抖动。 */
const BELLY_PTS: Pt[] = [
  [8, 58], [13, 62], [20, 66], [28, 68], [38, 69], [48, 68], [57, 66], [63, 62], [68, 58],
  [65, 54], [59, 58], [51, 61], [41, 63], [31, 62], [21, 58], [13, 53],
];

/** 胸鳍：只有一片，贴在腹侧偏前。 */
const FLIPPER: Pt[] = [[26, 60], [35, 62], [40, 68], [31, 70], [26, 65]];

const BELLY_FLAT = flatPath("whale:belly", seeded(BELLY_PTS, 0.45));
const FLIPPER_FLAT = flatPath("whale:flipper", FLIPPER);
const FLIPPER_INK = inkPath("whale:flipper", seeded(FLIPPER, 0.35), 1.8);

/** 月牙形喷气孔，靠头顶偏后。 */
const BLOWHOLE = "M42,26 q5,4 10,1";

/* ------------------------------------------------------------------ *
 * 五官表：眼 / 嘴 / 眉 / 腮红 / 尾摆 / 记号 / 水柱
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
  calm: { eyes: { kind: "dot" }, mouth: "arc", brows: "none", blush: "small", sway: 0 },
  happy: { eyes: { kind: "happy" }, mouth: "open", brows: "none", blush: "small", sway: -5, mark: "splash", spout: true },
  write: { eyes: { kind: "dot", look: [0, 1.4] }, mouth: "flat", brows: "none", blush: "small", sway: 2 },
  sleepy: { eyes: { kind: "closed" }, mouth: "tiny", brows: "none", blush: "small", sway: 3, mark: "z" },
  sad: { eyes: { kind: "dot", look: [0, 1] }, mouth: "frown", brows: "worried", blush: "small", sway: 5 },
  worried: { eyes: { kind: "dot", look: [0, 0.8] }, mouth: "frown", brows: "worried", blush: "small", sway: 4, mark: "sweat" },
  curious: { eyes: { kind: "dot", look: [1.1, -1.4] }, mouth: "o", brows: "one-up", blush: "small", sway: -3, spout: true },
  thinking: { eyes: { kind: "dot", look: [-1.1, -1.4] }, mouth: "flat", brows: "one-up", blush: "small", sway: 0, mark: "squiggle" },
  surprised: { eyes: { kind: "wide" }, mouth: "o", brows: "none", blush: "small", sway: -4 },
  shy: { eyes: { kind: "dot", look: [-0.9, 1.4] }, mouth: "tiny", brows: "none", blush: "big", sway: 2 },
  proud: { eyes: { kind: "happy" }, mouth: "arc", brows: "none", blush: "small", sway: -5, spout: true },
  hold: { eyes: { kind: "dot", look: [-1.1, 0.4] }, mouth: "tiny", brows: "none", blush: "small", sway: 1 },
  phone: { eyes: { kind: "dot", look: [0, 1.4] }, mouth: "tiny", brows: "none", blush: "small", sway: 1 },
  paper: { eyes: { kind: "dot", look: [1.1, 0.8] }, mouth: "tiny", brows: "none", blush: "small", sway: -1 },
};

/* ------------------------------------------------------------------ *
 * 小零件
 * ------------------------------------------------------------------ */

const Dot = ({ cx, cy, r = 2.1 }: { cx: number; cy: number; r?: number }) => <circle cx={cx} cy={cy} r={r} fill={INK} />;

const Line = ({ d, width = 1.8 }: { d: string; width?: number }) => (
  <path d={d} fill="none" stroke={INK} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
);

const Glint = ({ cx, cy, r = 1 }: { cx: number; cy: number; r?: number }) => <circle cx={cx} cy={cy} r={r} fill={SHEET} />;

/** 小手/鳍：握东西的几只手都用它。 */
const Fin = ({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) => (
  <g transform={`translate(${x} ${y})${flip ? " scale(-1 1)" : ""}`}>
    <path d="M0,0 C3,-3 8,-3 10,1 C7,5 3,5 0,2 Z" fill={BODY} />
    <path d="M0,0 C3,-3 8,-3 10,1 C7,5 3,5 0,2" fill="none" stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
  </g>
);

/* ------------------------------------------------------------------ *
 * 表情
 * ------------------------------------------------------------------ */

const EYE_L = { x: 30, y: 46 };
const EYE_R = { x: 41, y: 43 };

function Eyes({ shape }: { shape: Eyes }) {
  switch (shape.kind) {
    case "happy":
      return (
        <g className="whale-sticker__eyes">
          <Line d={`M${EYE_L.x - 4},${EYE_L.y + 2} q4,-5 8,0`} />
          <Line d={`M${EYE_R.x - 4},${EYE_R.y + 2} q4,-5 8,0`} />
        </g>
      );
    case "closed":
      return (
        <g className="whale-sticker__eyes">
          <Line d={`M${EYE_L.x - 4},${EYE_L.y - 0.5} q4,3.4 8,0`} width={1.6} />
          <Line d={`M${EYE_R.x - 4},${EYE_R.y - 0.5} q4,3.4 8,0`} width={1.6} />
        </g>
      );
    case "line":
      return (
        <g className="whale-sticker__eyes">
          <Line d={`M${EYE_L.x - 4},${EYE_L.y} h8`} />
          <Line d={`M${EYE_R.x - 4},${EYE_R.y} h8`} />
        </g>
      );
    case "wide": {
      const [dx, dy] = shape.look ?? [0, 0];
      return (
        <g className="whale-sticker__eyes">
          <Dot cx={EYE_L.x + dx} cy={EYE_L.y + dy} r={3.4} />
          <Glint cx={EYE_L.x + dx - 1} cy={EYE_L.y + dy - 1.2} r={1.2} />
          <Dot cx={EYE_R.x + dx} cy={EYE_R.y + dy} r={3.4} />
          <Glint cx={EYE_R.x + dx - 1} cy={EYE_R.y + dy - 1.2} r={1.2} />
        </g>
      );
    }
    default: {
      const [dx, dy] = shape.look ?? [0, 0];
      const r = shape.r ?? 2.1;
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
      return <path d="M8,55 h20 a10,7 0 0 1 -20,0 Z" fill={INK} />;
    case "o":
      return <ellipse cx={18} cy={57} rx={2.6} ry={3.2} fill={INK} />;
    case "frown":
      return <Line d={`M7,59 q10,-5.5 20,0`} width={1.6} />;
    case "flat":
      return <Line d="M8,57 h20" width={1.6} />;
    case "tiny":
      return <Line d="M12,57 q6,3 12,0" width={1.4} />;
    default:
      return <Line d="M7,57 q12,6 24,1" />;
  }
}

function Brows({ shape }: { shape: Brows }) {
  if (shape === "one-up") return <Line d="M15,36 q5.5,-4 10.5,-1.5" width={1.4} />;
  if (shape === "worried")
    return (
      <>
        <Line d="M22,36 L15,39" width={1.4} />
        <Line d="M29,35 L36,38" width={1.4} />
      </>
    );
  return null;
}

/** 头顶的记号：汗、Z、思考的墨线、水花。 */
function Mark({ shape }: { shape: Mark }) {
  switch (shape) {
    case "sweat":
      return <path d="M40,33 q3.4,4.8 0,6.6 q-3.4,-1.8 0,-6.6 Z" fill={SHEET} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />;
    case "z":
      return (
        <g>
          <Line d="M44,18 L51,18 L44,25 L51,25" width={1.4} />
          <Line d="M54,10 L60,10 L54,16 L60,16" width={1.2} />
        </g>
      );
    case "squiggle":
      return <Line d="M42,15 q4,-5.5 8,0 q4,5.5 8,0" width={1.4} />;
    case "splash":
      return (
        <g>
          <Line d="M16,20 q3.4,-5 7,0" width={1.3} />
          <Line d="M52,12 q3,-4.4 6,0" width={1.2} />
        </g>
      );
    default:
      return null;
  }
}

/** 水柱：从喷气孔往上的一小股（只有 happy / curious / proud 有）。 */
function Spout() {
  return (
    <g>
      <Line d="M45,25 q1.6,-6 -1,-10.5" width={1.3} />
      <Line d="M48,26 q4,-5 4,-10.5" width={1.2} />
      <Line d="M42,26 q-4,-4.5 -4,-9.5" width={1.2} />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * 手里拿的东西（都在 96×96 框内）
 * ------------------------------------------------------------------ */

function Props({ face }: { face: FaceKey }) {
  return (
    <>
      {face === "write" && (
        <g>
          <path d="M44,56 L64,56 L64,74 L44,74 Z" fill={SHEET} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
          <Line d="M47,62 L61,62" width={1} />
          <Line d="M47,67 L59,67" width={1} />
          <path d="M48,53 L56,44 L60,47 L52,56 Z" fill={BLUSH} stroke={INK} strokeWidth={1.1} strokeLinejoin="round" />
          <Fin x={35} y={62} />
        </g>
      )}
      {face === "hold" && (
        <g>
          <path d="M32,52 L39,52 L39,55 C43,58 43,61 43,65 C43,72 39,75 35.5,75 C32,75 28,72 28,65 C28,61 28,58 32,55 Z" fill={SHEET} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
          <Line d="M32,55 L39,55" width={0.9} />
          <path d="M32,66 L35.5,62 L39,67 Z" fill={SHEET} stroke={INK} strokeWidth={0.9} strokeLinejoin="round" />
          <Fin x={24} y={62} />
          <Fin x={50} y={62} flip />
        </g>
      )}
      {face === "phone" && (
        <g>
          <path d="M38,54 L52,54 C53.6,54 54,55 54,56.5 L54,74 C54,75.6 53,76.4 51.5,76.4 L39.5,76.4 C38,76.4 37,75.6 37,74 L37,56.5 C37,55 37.4,54 38,54 Z" fill={SHEET} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
          <g className="whale-sticker__ph">
            <Line d="M40,60 L51,60" width={1} />
            <Line d="M40,65 L51,65" width={1} />
            <Line d="M40,70 L51,70" width={1} />
          </g>
          <Fin x={28} y={63} />
          <Fin x={58} y={63} flip />
        </g>
      )}
      {face === "paper" && (
        <g>
          <path d="M30,48 L58,48 L58,65 L30,65 Z" fill={SHEET} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
          <Line d="M33,53 L46,53" width={1} />
          <Line d="M33,58 L55,58" width={1} />
          <Line d="M33,63 L49,63" width={1} />
          <g className="whale-sticker__pen">
            <circle cx={51} cy={61} r={1.2} fill={INK} />
          </g>
          <Fin x={24} y={62} />
          <Fin x={60} y={62} flip />
        </g>
      )}
    </>
  );
}

/** 举手（wave）：前鳍从身体背后抬起来，所以单独一层，画在身体之前。 */
function Behind({ wave }: { wave: boolean }) {
  if (!wave) return null;
  return <path d="M13,40 C5,29 7,20 14,18 C21,23 23,33 21,39 Z" fill={BODY} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />;
}

/* ------------------------------------------------------------------ *
 * 主体
 * ------------------------------------------------------------------ */

export function WhaleSticker({ mood = "idle", className = "", label }: Props) {
  const face = FACES[FACE[mood] ?? "calm"] ?? FACES.calm;
  const wave = mood === "wave";
  const pts = silhouette(face.sway);
  // 每个尾摆角度一条路径，模块级缓存；同一 (mood, 主题) 永远是同一条抖动。
  const flat = flatPath(`whale96:${face.sway}`, pts);
  const ink = inkPath(`whale96:${face.sway}`, seeded(pts), INK_SIZE);
  const cls = `whale-sticker ${mood === "idle" || mood === "calm" ? "whale-sticker--breath" : ""} ${className}`.trim();
  const blushR = face.blush === "big" ? 3.6 : 2.8;

  return (
    <svg
      className={cls}
      viewBox="0 0 96 96"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <Behind wave={wave} />
      {/* 贴纸白边：同一轮廓描边 8 的 --sheet，垫在最底层 */}
      <path d={ink} fill={SHEET} stroke={SHEET} strokeWidth={WHITE} strokeLinejoin="round" />
      {/* 平涂：身体 → 腹带 → 胸鳍 → 腮红 */}
      <path d={flat} fill={BODY} />
      <path d={BELLY_FLAT} fill={SHEET} />
      <path d={FLIPPER_FLAT} fill={BODY} />
      <path d={FLIPPER_INK} fill={INK} />
      <circle cx={11} cy={50} r={blushR} fill={BLUSH} />
      <circle cx={45} cy={50} r={blushR - 0.4} fill={BLUSH} />
      {/* 墨线轮廓压在最上层 */}
      <path d={ink} fill={INK} />
      {/* 喷气孔 + 可选水柱 */}
      <Line d={BLOWHOLE} width={1.6} />
      {face.spout && <Spout />}
      <Mark shape={face.mark ?? "none"} />
      {/* 五官 */}
      <Brows shape={face.brows} />
      <Eyes shape={face.eyes} />
      <Mouth shape={face.mouth} />
      <Props face={FACE[mood] ?? "calm"} />
    </svg>
  );
}
