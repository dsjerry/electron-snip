import { displayAt } from './geometry';
import type { Rect } from './types';

/**
 * 钉图窗口的布局常量。
 *
 * 窗口 = 图像 + **每侧自适应的阴影留白**：外阴影是画在窗口里的
 * （`transparent` 窗口 + CSS `box-shadow`），所以得先给阴影留出地方。
 * 主进程算每侧留白并随 `pin:boot` 下发，渲染进程按同一个 padding 让开画布 ——
 * 两边不一致的话，画布就会压在阴影上。
 *
 * 某一侧贴着屏幕边缘时留白是 0 —— 那边本来也没地方画阴影（桌面到头了）。
 */
export const PIN_SHADOW_PAD = 16;

/** 图像区最小 DIP 尺寸（选区过小时撑一下，免得窗口退化成一条缝）。 */
export const PIN_MIN_WIDTH = 120;
export const PIN_MIN_HEIGHT = 90;

/** 窗口四边的阴影留白（虚拟屏 DIP）。 */
export interface PinPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * 钉图窗口布局 = 图像 + **每侧自适应的阴影留白**。
 *
 * 外阴影画在窗口里（透明窗口 + CSS `box-shadow`），得先给它留地方；
 * 每侧留白 = 那侧屏幕还剩多少空间，最多 `PIN_SHADOW_PAD`，贴边就是 0
 * —— 桌面到头了，本来也画不出阴影。**图像位置永远等于选区**，留白只往
 * 窗外扩（没空间就缩到 0），不会把图挪走。
 */
export function computePinLayout(sel: Rect, displays: { bounds: Rect }[]): { bounds: Rect; padding: PinPadding } {
  const imageW = Math.max(PIN_MIN_WIDTH, Math.round(sel.width));
  const imageH = Math.max(PIN_MIN_HEIGHT, Math.round(sel.height));
  const x = Math.round(sel.x);
  const y = Math.round(sel.y);
  const midY = y + imageH / 2;
  const midX = x + imageW / 2;

  const dL = displayAt(displays, { x, y: midY }).bounds;
  const dR = displayAt(displays, { x: x + imageW, y: midY }).bounds;
  const dT = displayAt(displays, { x: midX, y }).bounds;
  const dB = displayAt(displays, { x: midX, y: y + imageH }).bounds;

  const pad = (room: number): number => Math.max(0, Math.min(PIN_SHADOW_PAD, Math.round(room)));

  const padding: PinPadding = {
    left: pad(x - dL.x),
    right: pad(dR.x + dR.width - (x + imageW)),
    top: pad(y - dT.y),
    bottom: pad(dB.y + dB.height - (y + imageH)),
  };

  return {
    padding,
    bounds: {
      x: x - padding.left,
      y: y - padding.top,
      width: imageW + padding.left + padding.right,
      height: imageH + padding.top + padding.bottom,
    },
  };
}
