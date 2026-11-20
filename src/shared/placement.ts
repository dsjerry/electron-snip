import type { Rect } from './types';

/**
 * 控制条（长图 / 录制）的落位：水平居中于选区，并夹在屏内（离屏边 8px）。
 * 默认贴选区下方；放不下翻到上方；再放不下贴屏底。
 * 纯函数，主进程与测试共用。
 */
export function placeBar(region: Rect, display: Rect, size: { width: number; height: number }, gap = 12): Rect {
  const { width, height } = size;
  const margin = 8;
  const x = Math.min(
    Math.max(display.x + margin, Math.round(region.x + region.width / 2 - width / 2)),
    display.x + display.width - width - margin,
  );
  let y = Math.round(region.y + region.height + gap);
  if (y + height > display.y + display.height) y = Math.round(region.y - height - gap);
  if (y < display.y) y = display.y + display.height - height - margin;
  return { x, y, width, height };
}
