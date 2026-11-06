/**
 * 图标烘焙（规范 §5.6）：24×24 骨架点列 → 手绘 `d` 字符串。
 *
 * 这是**构建期工具**：`Icon.tsx` 只读 `baked.ts`，运行时不会 import 本文件，
 * 所以 perfect-freehand 不进业务包，图标就是一个静态字符串表（可截图、可 diff）。
 * 笔参数全 19 个图标共用：size 2.2 / thinning .25 / smoothing .18 / streamline .18 /
 * simulatePressure false；逐点抖动 ±0.3；种子 = 图标名哈希。
 *
 * 改了 `icons.src.json` 之后重新生成 `baked.ts`（编译产物落在 node_modules 里，不脏仓库）：
 *   pnpm exec tsc --ignoreConfig src/components/ink-icons/bake.ts \
 *     --outDir node_modules/.cache/icon-bake --module commonjs --target es2022 \
 *     --esModuleInterop --skipLibCheck --types node
 *   echo '{"type":"commonjs"}' > node_modules/.cache/icon-bake/package.json
 *   node -e "const b=require('./node_modules/.cache/icon-bake/components/icons/bake.js');
 *     const s=require('./src/components/ink-icons/icons.src.json');
 *     require('node:fs').writeFileSync('src/components/ink-icons/baked.ts', b.renderBakedModule(b.bakeAll(s)));"
 */
import { getStroke } from "perfect-freehand";
import { hashSeed, outlineToPath, rng, type Pt } from "../../lib/ink";

/** 19 个图标共用的笔参数。 */
const PEN = { size: 2.2, thinning: 0.25, smoothing: 0.18, streamline: 0.18, simulatePressure: false };
const JITTER = 0.3;

/** "4,6 8,4 | 16,4" → [[[4,6],[8,4]], [[16,4]]]：`|` 分隔笔画。 */
export function parseSkeleton(src: string): Pt[][] {
  return src
    .split("|")
    .map((stroke) => stroke.trim())
    .filter(Boolean)
    .map((stroke) => stroke.split(/\s+/).map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return [x, y] as Pt;
    }));
}

/**
 * settings 的齿轮由函数生成（规范 §5.6）：8 齿、外半径 9、内半径 7、齿宽 22°，
 * 再加中心圆 r=3（35 点采样）。这样每个齿的间距都是精确的 45°。
 */
export function gearStrokes(): Pt[][] {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const at = (deg: number, r: number): Pt => [12 + Math.cos(rad(deg)) * r, 12 + Math.sin(rad(deg)) * r];
  const outer = 9;
  const inner = 7;
  const outline: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 45 - 90; // 第 0 个齿的齿尖朝上
    outline.push(at(a - 11, outer), at(a, outer), at(a + 11, outer));
    outline.push(at(a + 14, outer - 1.2));
    outline.push(at(a + 17, inner), at(a + 22.5, inner), at(a + 28, inner));
    outline.push(at(a + 31, outer - 1.2));
  }
  const center: Pt[] = Array.from({ length: 35 }, (_, k) => at((k / 35) * 360, 3));
  return [outline, center];
}

function jitter(points: Pt[], next: () => number): Pt[] {
  return points.map(([x, y]) => [x + (next() - 0.5) * 2 * JITTER, y + (next() - 0.5) * 2 * JITTER]);
}

/** 一个图标的全部笔画 → 全部 `d`（每笔一条 path）。 */
export function bakeIcon(name: string, strokes: Pt[][]): string[] {
  const next = rng(hashSeed(`icon:${name}`));
  return strokes.map((stroke) => outlineToPath(getStroke(jitter(stroke, next), PEN)));
}

/** 整张骨架表 → 整张 `d` 表。settings 走齿轮函数，其余解析骨架字符串。 */
export function bakeAll(source: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, src] of Object.entries(source)) {
    if (name.startsWith("_")) continue; // JSON 里的说明字段
    out[name] = bakeIcon(name, name === "settings" ? gearStrokes() : parseSkeleton(src));
  }
  return out;
}

/** 生成 `baked.ts` 的源码文本（提交它，运行时就只用字符串）。 */
export function renderBakedModule(paths: Record<string, string[]>): string {
  const rows = Object.entries(paths).map(([name, ds]) => `  ${JSON.stringify(name)}: ${JSON.stringify(ds)},`);
  return [
    "/** 自动生成，勿手改：由 `bake.ts` 从 `icons.src.json` 烘焙而来（规范 §5.6）。 */",
    "",
    "export const ICON_PATHS = {",
    ...rows,
    "} as const;",
    "",
    "export type IconName = keyof typeof ICON_PATHS;",
    "",
    "/** 19 个图标的顺序表，给需要遍历的界面（图标选择、自检）用。 */",
    "export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];",
    "",
  ].join("\n");
}
