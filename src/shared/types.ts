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

export type ToolId = 'hand' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'pen' | 'marker' | 'mosaic' | 'counter' | 'text';

export interface StrokeBase {
  color: string;
  width: number;
}

/**
 * 所有标注坐标都在**图像像素空间**（画布 backing store 的像素），
 * 与窗口 DIP / devicePixelRatio 无关，因此拖动窗口不会让标注错位。
 */
/** 箭头样式：实心（整支填充）/ 空心（整支描边，杆身与头部同为空心） */
export type ArrowHead = 'solid' | 'open';

/** 马赛克绘制形式：选区（拖矩形）/ 涂抹（沿路径的笔刷圆斑）/ 高斯模糊 */
export type MosaicMode = 'region' | 'brush' | 'blur';

export type Shape =
  | ({ type: 'arrow' } & StrokeBase & {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        head: ArrowHead;
      })
  | ({ type: 'line' } & StrokeBase & {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      })
  | ({ type: 'rect' } & StrokeBase & { x: number; y: number; w: number; h: number })
  | ({ type: 'ellipse' } & StrokeBase & { x: number; y: number; w: number; h: number })
  | ({ type: 'pen' } & StrokeBase & { points: Point[] })
  | ({ type: 'mosaic' } & (
      | { mode: 'region'; x: number; y: number; w: number; h: number }
      | { mode: 'brush'; points: Point[]; radius: number }
      | { mode: 'blur'; x: number; y: number; w: number; h: number }
    ))
  | { type: 'counter'; x: number; y: number; n: number; color: string }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number };
