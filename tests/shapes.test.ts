import { describe, expect, it } from 'vitest';
import { applyShapeHandle, canResize, cloneShape, translateShape, withColor } from '../src/annotations/shapes';
import { toolUsesWidth } from '../src/annotations/tools';
import type { Shape } from '../src/shared/types';

// 下面这些函数在箭头 / 直线 / 矩形分支不碰 canvas，传一个占位上下文即可
const noCtx = {} as CanvasRenderingContext2D;

const rect: Shape = { type: 'rect', color: '#f00', width: 4, x: 10, y: 20, w: 100, h: 50 };
const pen: Shape = {
  type: 'pen',
  color: '#0f0',
  width: 2,
  points: [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ],
};
const arrow: Shape = { type: 'arrow', color: '#00f', width: 3, x1: 0, y1: 0, x2: 50, y2: 60, head: 'solid' };

describe('图形纯函数', () => {
  it('cloneShape 深拷贝画笔点数组，修改副本不影响原对象', () => {
    const copy = cloneShape(pen);
    if (copy.type !== 'pen') throw new Error('unexpected');
    copy.points[0].x = 999;
    expect(pen.type === 'pen' && pen.points[0].x).toBe(1);
  });

  it('translateShape 平移坐标，不修改原对象', () => {
    const moved = translateShape(rect, 5, -5);
    expect(moved).toMatchObject({ x: 15, y: 15, w: 100, h: 50 });
    expect(rect).toMatchObject({ x: 10, y: 20 });
  });

  it('translateShape 平移画笔的每个点', () => {
    const moved = translateShape(pen, 10, 10);
    expect(moved.type === 'pen' && moved.points).toEqual([
      { x: 11, y: 11 },
      { x: 12, y: 12 },
    ]);
  });

  it('withColor 对马赛克原样返回，其余图形改色', () => {
    expect(withColor(rect, '#123')).toMatchObject({ color: '#123' });
    const mosaic: Shape = { type: 'mosaic', mode: 'region', x: 0, y: 0, w: 10, h: 10 };
    expect(withColor(mosaic, '#123')).toBe(mosaic);
  });

  it('canResize 仅矩形 / 椭圆 / 箭头 / 直线支持手柄缩放', () => {
    expect(canResize(rect)).toBe(true);
    expect(canResize(arrow)).toBe(true);
    expect(canResize(pen)).toBe(false);
  });

  it('applyShapeHandle 拖动箭头端点只改对应端点', () => {
    const next = applyShapeHandle(arrow, 'p2', { x: 80, y: 90 }, noCtx);
    expect(next).toMatchObject({ x1: 0, y1: 0, x2: 80, y2: 90 });
    expect(arrow).toMatchObject({ x2: 50, y2: 60 });
  });
});

describe('toolUsesWidth', () => {
  it('吃线宽的工具返回 true，手型与文字不吃', () => {
    expect(toolUsesWidth('rect', 'region')).toBe(true);
    expect(toolUsesWidth('hand', 'region')).toBe(false);
    expect(toolUsesWidth('text', 'region')).toBe(false);
  });

  it('马赛克仅在涂抹模式下吃线宽（笔刷半径）', () => {
    expect(toolUsesWidth('mosaic', 'brush')).toBe(true);
    expect(toolUsesWidth('mosaic', 'region')).toBe(false);
    expect(toolUsesWidth('mosaic', 'blur')).toBe(false);
  });
});
