/** 点击区域划分：优先用模型自带 HitAreas，没有就按包围盒上 1/3 为头、其余为身体。 */
export type HitRegion = "head" | "body";

const HEAD_PATTERN = /head|face|hair|頭|头|脸|臉|发/i;

export function regionFromHitAreas(names: readonly string[]): HitRegion | null {
  if (names.length === 0) return null;
  return names.some((name) => HEAD_PATTERN.test(name)) ? "head" : "body";
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function regionFromBounds(box: Box, y: number): HitRegion {
  if (box.height <= 0) return "body";
  return (y - box.y) / box.height < 1 / 3 ? "head" : "body";
}

export function classifyTap(hitNames: readonly string[], box: Box, y: number): HitRegion {
  return regionFromHitAreas(hitNames) ?? regionFromBounds(box, y);
}
