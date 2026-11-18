/** 与方向无关的点，单位一律是虚拟屏 DIP（可为负）。 */
export interface Point {
  x: number;
  y: number;
}

/** 矩形，单位一律是虚拟屏 DIP（可为负）。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 一块显示器的截图。
 *
 * `scaleX/scaleY` 是「每 DIP 对应多少物理像素」，从 `thumbnail.getSize()`
 * 回读得到 —— Electron 文档明确 thumbnailSize 不保证被遵守，
 * 所以绝不能直接用 `display.scaleFactor`。
 */
export interface DisplayShot {
  displayId: number;
  bounds: Rect;
  scaleX: number;
  scaleY: number;
  imageWidth: number;
  imageHeight: number;
  /**
   * 屏幕原始位图（RGBA，imageWidth × imageHeight × 4 字节）。
   * 不用 PNG：整屏 PNG 的同步编码 + 渲染端解码要几百毫秒，
   * 原始位图 IPC 直传（structured clone 一次 memcpy）然后直接进 ImageData。
   */
  pixels: Uint8Array;
}
