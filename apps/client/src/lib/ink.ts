/**
 * 手绘墨线基元（重设计规范 §5.2–§5.5）。
 *
 * 三条硬约束：
 * 1. **确定性**：所有抖动都来自 `rng(seed)`（mulberry32），同一 `(variant, seed, size)` 永远
 *    得到逐字节相同的 `d`，截图/回归可复现。
 * 2. **模块级缓存**：算过的路径放进 `Map`，滚动、重渲染、ResizeObserver 回调都不重算
 *    （InkFrame 还会把尺寸往上取整到 8 的倍数再进 key，拖动窗口时不会每帧重算）。
 * 3. **只在几何层做数学**：这里不产生任何颜色/CSS，颜色由组件的 `currentColor` 与 token 决定。
 */
import { getStroke } from "perfect-freehand";

export type Pt = [number, number];

/** 确定性伪随机（mulberry32）。同一 seed 永远得到同一串数，这是「手绘但稳定」的根。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** perfect-freehand 的输出点列 → SVG path（README 里的标准转换：二次贝塞尔串）。 */
export function outlineToPath(pts: number[][]): string {
  if (pts.length < 4) return "";
  const f = (n: number) => n.toFixed(2);
  let d = `M${f(pts[0][0])},${f(pts[0][1])} Q`;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    d += `${f(x0)},${f(y0)} ${f((x0 + x1) / 2)},${f((y0 + y1) / 2)} `;
  }
  return d + "Z";
}

const cache = new Map<string, string>();

/** 模块级缓存：同一个 key 只画一次。key 必须覆盖所有影响结果的输入。 */
export function cached(key: string, make: () => string): string {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

/** 字符串 → 稳定种子（FNV-1a）。给「没传 seed 的组件」一个同一 id 永远相同的抖动。 */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ *
 * §5.2 水平手绘线：<InkLine/>
 * ------------------------------------------------------------------ */

/** 三种线各自的画布尺寸（viewBox 单位）。squiggle 更高，因为波浪幅度更大。 */
export const INK_LINE_BOX = {
  divider: { w: 600, h: 12 },
  underline: { w: 600, h: 12 },
  squiggle: { w: 600, h: 16 },
} as const;

export type InkLineVariant = keyof typeof INK_LINE_BOX;

/**
 * 水平手绘线：viewBox 600×12（squiggle 600×16）。
 * 低频起伏 + 每点 ±1.6 抖动；divider/underline 是一次起伏，squiggle 是两段波形。
 */
export function inkLinePath(seed: number, size = 2.4, variant: InkLineVariant = "divider"): string {
  return cached(`line:${variant}:${seed}:${size}`, () => {
    const r = rng(seed);
    const box = INK_LINE_BOX[variant];
    const squiggle = variant === "squiggle";
    const n = squiggle ? 22 : 16;
    const phase = r() * 6.283;
    const amp = squiggle ? 4.4 : 1.2;
    const cycles = squiggle ? 2 : 1;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([
        12 + t * (box.w - 24),
        box.h / 2 + Math.sin(t * 6.283 * cycles + phase) * amp + (r() - 0.5) * 3.2,
      ]);
    }
    return outlineToPath(
      getStroke(pts, {
        size,
        thinning: squiggle ? 0.5 : 0.55,
        smoothing: 0.6,
        streamline: 0.45,
        simulatePressure: true,
        start: { taper: 40 },
        end: { taper: 90 },
      }),
    );
  });
}

/* ------------------------------------------------------------------ *
 * §5.3 手绘框：<InkFrame/>
 * ------------------------------------------------------------------ */

/** 圆角矩形的取点：四边各 ≥ len/24 个点，四角各 6 个点沿圆弧，每点抖动 ±1.1。 */
function rectLoop(w: number, h: number, r: number, seed: number): Pt[] {
  const rand = rng(seed);
  const j = () => (rand() - 0.5) * 2.2;
  const pts: Pt[] = [];
  const at = (x: number, y: number) => pts.push([x + j(), y + j()]);
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i < 6; i++) {
      const a = a0 + ((a1 - a0) * i) / 6;
      at(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 24));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  };
  // 顺时针一圈：左上角弧 → 上边 → 右上角弧 → 右边 → 右下角弧 → 下边 → 左下角弧 → 左边
  arc(r, r, Math.PI, Math.PI * 1.5);
  line(r, 0, w - r, 0);
  arc(w - r, r, -Math.PI / 2, 0);
  line(w, r, w, h - r);
  arc(w - r, h - r, 0, Math.PI / 2);
  line(w - r, h, r, h);
  arc(r, h - r, Math.PI / 2, Math.PI);
  line(0, h - r, 0, r);
  return pts;
}

function rotateTo(points: Pt[], index: number): Pt[] {
  return points.slice(index).concat(points.slice(0, index));
}

function nearestIndex(points: Pt[], target: Pt): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = (points[i][0] - target[0]) ** 2 + (points[i][1] - target[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 沿闭合点列留出 `gap` 长度的缺口（端点插值到缺口边缘）。 */
function trimLoop(points: Pt[], gap: number): Pt[] {
  const n = points.length;
  if (n < 3 || gap <= 0) return points;
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push(d);
    total += d;
  }
  const keep = Math.max(total * 0.5, total - gap);
  const out: Pt[] = [points[0]];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = segs[i];
    if (acc + d >= keep) {
      const t = (keep - acc) / (d || 1);
      const a = points[i];
      const b = points[(i + 1) % n];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      break;
    }
    acc += d;
    out.push(points[(i + 1) % n]);
  }
  return out;
}

export type InkFrameGeom = {
  /** 画布宽（已是 8 的倍数，见 InkFrame 的取整） */
  w: number;
  h: number;
  /** 圆角（viewBox 单位） */
  radius: number;
  /** 线宽（规范值 2；老人模式 3） */
  stroke: number;
  seed: number;
  /** 左上角留 ~6px 缺口，像一笔画完没接上 */
  openCorner?: boolean;
};

/**
 * 手绘圆角矩形的一笔轮廓。openCorner 时缺口落在左上角弧线的中点上，
 * 长度固定 18（viewBox 单位，肉眼可见的断口），与画笔粗细无关，所以同一 seed 的缺口位置稳定。
 */
export function inkFramePath({ w, h, radius, stroke, seed, openCorner = false }: InkFrameGeom): string {
  const open = openCorner ? "open" : "closed";
  return cached(`frame:${w}:${h}:${radius}:${stroke}:${seed}:${open}`, () => {
    const r = Math.max(0.001, Math.min(radius, w / 2, h / 2));
    let loop = rectLoop(w, h, r, seed);
    if (openCorner) {
      const tl = r - r * 0.7071; // 左上角弧线中点
      loop = trimLoop(rotateTo(loop, nearestIndex(loop, [tl, tl])), 18);
    }
    return outlineToPath(
      getStroke(loop, {
        size: stroke * 1.5,
        thinning: 0.4,
        smoothing: 0.55,
        streamline: 0.5,
        simulatePressure: true,
        start: { taper: 20 },
        end: { taper: 30 },
        last: !openCorner,
      }),
    );
  });
}

/* ------------------------------------------------------------------ *
 * §5.4 邮戳的外圈圆
 * ------------------------------------------------------------------ */

/**
 * 手绘圆：半径 r，抖动 ±0.8，不完全闭合缺 `gapDeg` 度。
 * 坐标系原点在圆心，调用方给 viewBox `0 0 2r 2r`。
 */
export function inkCirclePath(seed: number, r: number, stroke: number, gapDeg = 12): string {
  return cached(`circle:${seed}:${r}:${stroke}:${gapDeg}`, () => {
    const rand = rng(seed);
    const n = 48;
    const start = rand() * 6.283;
    const span = 6.283 * (1 - gapDeg / 360);
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = start + (span * i) / n;
      const rr = r + (rand() - 0.5) * 1.6;
      pts.push([r + Math.cos(a) * rr, r + Math.sin(a) * rr]);
    }
    return outlineToPath(
      getStroke(pts, {
        size: stroke,
        thinning: 0.4,
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: true,
        start: { taper: 24 },
        end: { taper: 32 },
        last: false,
      }),
    );
  });
}

/* ------------------------------------------------------------------ *
 * §5.5 浪：<Tide/>
 * ------------------------------------------------------------------ */

export type WaveOpts = {
  /** 宽度，2880 = 两个 1440，位移 -50% 时无缝 */
  w?: number;
  h?: number;
  base?: number;
  amp?: [number, number];
  /** len 必须整除 1440：720 / 480 / 360 / 240 / 180 */
  len?: [number, number];
  step?: number;
};

type ResolvedWave = Required<WaveOpts>;

const waveKey = (seed: number, o: ResolvedWave) =>
  `w${seed}:${o.w}:${o.h}:${o.base}:${o.amp[0]}:${o.amp[1]}:${o.len[0]}:${o.len[1]}:${o.step}`;

const wavePointCache = new Map<string, Pt[]>();

function resolveWave(o: WaveOpts): ResolvedWave {
  return {
    w: o.w ?? 2880,
    h: o.h ?? 200,
    base: o.base ?? 0.5,
    amp: o.amp ?? [14, 6],
    len: o.len ?? [720, 360],
    step: o.step ?? 24,
  };
}

/** 确定性的正弦叠加 + 轻微噪声。浪与浪线共用同一串点，所以浪线的顶缘永远贴合浪面。 */
function wavePoints(seed: number, opts: WaveOpts): Pt[] {
  const o = resolveWave(opts);
  const key = waveKey(seed, o);
  const hit = wavePointCache.get(key);
  if (hit) return hit;
  const r = rng(seed);
  const p1 = r() * 6.283;
  const p2 = r() * 6.283;
  const pts: Pt[] = [];
  for (let x = 0; x <= o.w; x += o.step) {
    const y =
      o.h * o.base +
      o.amp[0] * Math.sin((x / o.len[0]) * 6.283 + p1) +
      o.amp[1] * Math.sin((x / o.len[1]) * 6.283 + p2) +
      (r() - 0.5) * 1.2;
    pts.push([x, y]);
  }
  wavePointCache.set(key, pts);
  return pts;
}

/** 平涂浪面（闭合到画布底部）。 */
export function wavePath(seed: number, opts: WaveOpts = {}): string {
  const o = resolveWave(opts);
  return cached(`wave:${waveKey(seed, o)}`, () => {
    let d = `M0 ${o.h}`;
    for (const [x, y] of wavePoints(seed, opts)) d += ` L${x} ${y.toFixed(1)}`;
    return d + ` L${o.w} ${o.h} Z`;
  });
}

/** 浪线：沿浪的顶缘画一笔（纸色 80%），用笔宽 3.2 的手绘线。 */
export function waveCrestPath(seed: number, opts: WaveOpts = {}, size = 3.2): string {
  const o = resolveWave(opts);
  return cached(`crest:${waveKey(seed, o)}:${size}`, () =>
    outlineToPath(
      getStroke(wavePoints(seed, opts), {
        size,
        thinning: 0.5,
        smoothing: 0.6,
        streamline: 0.5,
        simulatePressure: false,
        start: { cap: true },
        end: { cap: true },
      }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * 平涂图形（贴纸/图标之外的小配件）：平滑闭合曲线 + 手绘描边
 * ------------------------------------------------------------------ */

/** Catmull-Rom 转三次贝塞尔：给「平涂色块」一个圆润、不像多边形的轮廓。 */
export function smoothClosedPath(points: Pt[]): string {
  const n = points.length;
  if (n < 3) return "";
  const f = (v: number) => v.toFixed(2);
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)}`;
    d += ` ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)}`;
    d += ` ${f(p2[0])},${f(p2[1])}`;
  }
  return d + "Z";
}

/** 平涂形状（闭合），带模块级缓存。 */
export function flatPath(key: string, points: Pt[]): string {
  return cached(`flat:${key}`, () => smoothClosedPath(points));
}

/** 手绘描边（给定骨架点列），带模块级缓存。贴纸的轮廓与道具都走这里。 */
export function inkPath(key: string, points: Pt[], size = 3.2): string {
  return cached(`ink:${key}:${size}`, () =>
    outlineToPath(
      getStroke(points, {
        size,
        thinning: 0.45,
        smoothing: 0.55,
        streamline: 0.45,
        simulatePressure: true,
        start: { taper: 18 },
        end: { taper: 26 },
      }),
    ),
  );
}

/** 四角星（暗色浪面上的星，平涂，不闪烁）。 */
export function fourPointStarPath(cx: number, cy: number, r: number): string {
  const k = r * 0.22;
  return (
    `M${cx},${cy - r} Q${cx + k},${cy - k} ${cx + r},${cy} ` +
    `Q${cx + k},${cy + k} ${cx},${cy + r} ` +
    `Q${cx - k},${cy + k} ${cx - r},${cy} ` +
    `Q${cx - k},${cy - k} ${cx},${cy - r}Z`
  );
}

/* ------------------------------------------------------------------ *
 * 圆角：只认 token 的四档 + 圆
 * ------------------------------------------------------------------ */

/** 数值圆角 → 规范里的一档 token。禁止在业务代码里写 px 圆角。 */
export function radiusToken(n: number): string {
  if (n <= 6) return "var(--r-xs)";
  if (n <= 11) return "var(--r-sm)";
  if (n <= 17) return "var(--r-md)";
  if (n <= 30) return "var(--r-lg)";
  return "var(--r-round)";
}
