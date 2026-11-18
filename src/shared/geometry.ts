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
