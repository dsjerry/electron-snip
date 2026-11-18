import { describe, expect, it } from 'vitest';
import { mapShape } from '../src/shared/shape-transform';
import type { Shape } from '../src/shared/types';

describe('mapShape（本屏 DIP → 选区图像像素）', () => {
  it('矩形：先平移再乘比例，尺寸一起放大', () => {
    const rect: Shape = { type: 'rect', color: '#f00', width: 2, x: 10, y: 20, w: 30, h: 40 };
    expect(mapShape(rect, 5, -5, 2)).toMatchObject({ x: 30, y: 30, w: 60, h: 80 });
  });

  it('线宽 / 字号随比例放大', () => {
    const text: Shape = { type: 'text', x: 1, y: 2, text: 'hi', color: '#000', size: 12 };
    expect(mapShape(text, 0, 0, 1.5)).toMatchObject({ size: 18 });
    const line: Shape = { type: 'line', color: '#000', width: 3, x1: 0, y1: 0, x2: 10, y2: 10 };
    expect(mapShape(line, 0, 0, 2)).toMatchObject({ width: 6, x2: 20, y2: 20 });
  });

  it('画笔的每个点都换算', () => {
    const pen: Shape = {
      type: 'pen',
      color: '#000',
      width: 1,
      points: [{ x: 1, y: 1 }],
    };
    const out = mapShape(pen, 10, 0, 2);
    expect(out.type === 'pen' && out.points).toEqual([{ x: 22, y: 2 }]);
  });

  it('涂抹马赛克的半径也换算', () => {
    const brush: Shape = { type: 'mosaic', mode: 'brush', points: [{ x: 0, y: 0 }], radius: 5 };
    const out = mapShape(brush, 0, 0, 3);
    expect(out).toMatchObject({ radius: 15 });
  });

  it('不改写原对象', () => {
    const rect: Shape = { type: 'rect', color: '#f00', width: 2, x: 1, y: 1, w: 1, h: 1 };
    mapShape(rect, 100, 100, 4);
    expect(rect).toMatchObject({ x: 1, y: 1, w: 1, h: 1 });
  });
});
