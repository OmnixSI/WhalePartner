import type * as PIXI from "pixi.js";
import type { Live2DModel } from "pixi-live2d-display/cubism4";

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
  const bounds = model.getLocalBounds();
  if (bounds.width < 1 || bounds.height < 1) return;

  const targetHeight = Math.min(readRatio("--stage-char-h", 0.6) * height, height * readRatio("--stage-char-max", 0.94));
  const targetWidth = width * readRatio("--stage-char-w", 0.94);
  const scale = Math.min(targetHeight / bounds.height, targetWidth / bounds.width);
  const gap = readRatio("--stage-char-gap", 0.02) * height;

  model.anchor.set(0.5, 1);
  model.scale.set(scale);
  model.position.set(width / 2, height - gap);
}
