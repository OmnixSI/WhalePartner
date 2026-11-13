import type * as PIXI from "pixi.js";
import type { Live2DModel } from "pixi-live2d-display/cubism4";

type Box = { x: number; y: number; width: number; height: number };
type DrawableCore = { getDrawableCount?: () => number; getDrawableOpacity?: (i: number) => number };
type BoundsModel = {
  coreModel: DrawableCore;
  localTransform: PIXI.Matrix;
  getDrawableBounds: (i: number, out?: Box) => Box;
};

const visibleCache = new WeakMap<Live2DModel, Box | null>();

/**
 * 模型「看得见的部分」在本地坐标里的外框：只算不透明度大于 0 的网格。
 * 模型画布（getLocalBounds）四周常留一圈透明边，按画布摆位时人物只占目标高度的七八成。
 * 第一次摆位时量一次（默认姿势），之后复用；拿不到网格信息时退回整块画布。
 */
function visibleBounds(model: Live2DModel): Box | null {
  if (visibleCache.has(model)) return visibleCache.get(model) ?? null;
  let box: Box | null = null;
  const internal = model.internalModel as unknown as BoundsModel;
  const core = internal.coreModel;
  const count = core.getDrawableCount?.() ?? 0;
  if (count > 0 && core.getDrawableOpacity && internal.getDrawableBounds) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    const tmp: Box = { x: 0, y: 0, width: 0, height: 0 };
    for (let i = 0; i < count; i++) {
      if (!(core.getDrawableOpacity(i) > 0)) continue;
      const b = internal.getDrawableBounds(i, tmp);
      if (!(b.width > 0 && b.height > 0)) continue;
      left = Math.min(left, b.x);
      top = Math.min(top, b.y);
      right = Math.max(right, b.x + b.width);
      bottom = Math.max(bottom, b.y + b.height);
    }
    if (right > left && bottom > top) {
      const m = internal.localTransform;
      box = { x: m.a * left + m.tx, y: m.d * top + m.ty, width: m.a * (right - left), height: m.d * (bottom - top) };
    }
  }
  visibleCache.set(model, box);
  return box;
}

export function placeModel(host: HTMLElement, renderer: PIXI.Renderer, model: Live2DModel) {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (!width || !height) return;

  if (renderer.screen.width !== width || renderer.screen.height !== height) renderer.resize(width, height);
  const scene = host.closest<HTMLElement>(".scene") ?? host;
  const style = getComputedStyle(scene);
  const readRatio = (name: string, fallback: number) => {
    const value = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const canvas = model.getLocalBounds();
  if (canvas.width < 1 || canvas.height < 1) return;
  // --stage-char-fit: visible 时按看得见的部分构图（聊天舞台）；缺省按整块模型画布（闪卡沿用原参数）
  const fitVisible = style.getPropertyValue("--stage-char-fit").trim() === "visible";
  const bounds = (fitVisible && visibleBounds(model)) || canvas;

  const targetHeight = Math.min(readRatio("--stage-char-h", 0.6) * height, height * readRatio("--stage-char-max", 0.94));
  const targetWidth = width * readRatio("--stage-char-w", 0.94);
  const scale = Math.min(targetHeight / bounds.height, targetWidth / bounds.width);
  const gap = readRatio("--stage-char-gap", 0.02) * height;

  // 锚点放在构图框的底边中点：摆位和点击时的弹跳缩放都以它为基准
  model.anchor.set((bounds.x + bounds.width / 2 - canvas.x) / canvas.width, (bounds.y + bounds.height - canvas.y) / canvas.height);
  model.scale.set(scale);
  model.position.set(width / 2, height - gap);
}
