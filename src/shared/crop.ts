import type { DisplayShot, Rect } from './types';

/** 裁剪结果：物理像素的 RGBA 条带 */
export interface RgbaFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/** 按选区裁出物理像素条带（行拷贝，源是整屏 RGBA 位图）。 */
export function cropShot(shot: DisplayShot, region: Rect): RgbaFrame {
  const x0 = Math.max(0, Math.round((region.x - shot.bounds.x) * shot.scaleX));
  const y0 = Math.max(0, Math.round((region.y - shot.bounds.y) * shot.scaleY));
  const x1 = Math.min(shot.imageWidth, Math.round((region.x + region.width - shot.bounds.x) * shot.scaleX));
  const y1 = Math.min(shot.imageHeight, Math.round((region.y + region.height - shot.bounds.y) * shot.scaleY));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcStart = ((y0 + row) * shot.imageWidth + x0) * 4;
    out.set(shot.pixels.subarray(srcStart, srcStart + w * 4), row * w * 4);
  }
  return { pixels: out, width: w, height: h };
}
