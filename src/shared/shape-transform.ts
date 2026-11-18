import type { Shape } from './types';

/**
 * 标注坐标换算：本屏 DIP → 选区坐标系（平移 dx/dy）再乘输出比例 k。
 * 线宽 / 字号 / 半径一起放大，保证导出的图与屏幕上看到的比例一致。
 */
export function mapShape(shape: Shape, dx: number, dy: number, k: number): Shape {
  switch (shape.type) {
    case 'arrow':
    case 'line':
      return {
        ...shape,
        x1: (shape.x1 + dx) * k,
        y1: (shape.y1 + dy) * k,
        x2: (shape.x2 + dx) * k,
        y2: (shape.y2 + dy) * k,
        width: shape.width * k,
      };
    case 'counter':
      return {
        ...shape,
        x: (shape.x + dx) * k,
        y: (shape.y + dy) * k,
      };
    case 'pen':
      return {
        ...shape,
        width: shape.width * k,
        points: shape.points.map((p) => ({
          x: (p.x + dx) * k,
          y: (p.y + dy) * k,
        })),
      };
    case 'text':
      return {
        ...shape,
        x: (shape.x + dx) * k,
        y: (shape.y + dy) * k,
        size: shape.size * k,
      };
    case 'mosaic':
      if (shape.mode === 'brush') {
        // 涂抹：点与半径一起换算
        return {
          ...shape,
          radius: shape.radius * k,
          points: shape.points.map((p) => ({
            x: (p.x + dx) * k,
            y: (p.y + dy) * k,
          })),
        };
      }
      return {
        ...shape,
        x: (shape.x + dx) * k,
        y: (shape.y + dy) * k,
        w: shape.w * k,
        h: shape.h * k,
      };
    default:
      // rect / ellipse：w、h 可能是负的，×正数方向不变
      return {
        ...shape,
        x: (shape.x + dx) * k,
        y: (shape.y + dy) * k,
        w: shape.w * k,
        h: shape.h * k,
      };
  }
}
