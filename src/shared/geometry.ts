import type { DisplayShot, Rect } from './types';

export function unionBounds(displays: { bounds: Rect }[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of displays) {
    const b = d.bounds;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 输出缩放：取相交屏里的最大比例。
 * 用主屏比例会**不可逆**地丢掉 150% 屏的文字像素；放大不丢数据，缩小才丢。
 */
export function resolveOutScale(shots: Pick<DisplayShot, 'bounds' | 'scaleX' | 'scaleY'>[], selection: Rect): number {
  let out = 0;
  for (const shot of shots) {
    if (!intersects(shot.bounds, selection)) continue;
    out = Math.max(out, shot.scaleX, shot.scaleY);
  }
  return out > 0 ? out : 1;
}

/** 点所在的显示器（边界按左闭右开）；都不包含时退回第一块屏。 */
export function displayAt<T extends { bounds: Rect }>(displays: T[], p: { x: number; y: number }): T {
  return (
    displays.find(
      (d) =>
        p.x >= d.bounds.x &&
        p.x < d.bounds.x + d.bounds.width &&
        p.y >= d.bounds.y &&
        p.y < d.bounds.y + d.bounds.height,
    ) ?? displays[0]
  );
}

/**
 * 选区与各屏求最大交集，返回交集所在的那块屏及区域（单屏内才能录制 / 长图 / OCR）。
 * 最大化窗口的隐形边框自然被裁回屏内。没有任何交集返回 null。
 */
export function bestRegionOnDisplay(
  shots: Pick<DisplayShot, 'bounds'>[],
  sel: Rect,
): { index: number; region: Rect } | null {
  let bestIndex = -1;
  let bestRegion: Rect | null = null;
  let bestArea = 0;
  shots.forEach((shot, index) => {
    const b = shot.bounds;
    const x0 = Math.max(sel.x, b.x);
    const y0 = Math.max(sel.y, b.y);
    const x1 = Math.min(sel.x + sel.width, b.x + b.width);
    const y1 = Math.min(sel.y + sel.height, b.y + b.height);
    const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    if (area > bestArea) {
      bestArea = area;
      bestIndex = index;
      bestRegion = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
  });
  return bestRegion ? { index: bestIndex, region: bestRegion } : null;
}
