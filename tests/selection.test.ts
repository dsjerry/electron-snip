import { describe, expect, it } from 'vitest';
import {
  clampRect,
  handlePoint,
  hitBorder,
  hitHandle,
  hitHandleIn,
  moveRect,
  pointInRect,
  resizeRect,
} from '../src/shared/selection';
import type { Rect } from '../src/shared/types';

const sel: Rect = { x: 100, y: 100, width: 200, height: 100 };

describe('手柄几何', () => {
  it('8 个手柄位于选区角与边中点', () => {
    expect(handlePoint(sel, 'nw')).toEqual({ x: 100, y: 100 });
    expect(handlePoint(sel, 'e')).toEqual({ x: 300, y: 150 });
    expect(handlePoint(sel, 'se')).toEqual({ x: 300, y: 200 });
  });

  it('hitHandle 在半径内命中，半径外不命中', () => {
    expect(hitHandle(sel, { x: 105, y: 104 })).toBe('nw');
    expect(hitHandle(sel, { x: 150, y: 150 })).toBeNull();
  });

  it('零尺寸选区没有手柄', () => {
    expect(hitHandle({ ...sel, width: 0 }, { x: 100, y: 100 })).toBeNull();
  });

  it('hitHandleIn 跳过落在本窗口之外的手柄', () => {
    const origin: Rect = { x: 250, y: 0, width: 300, height: 300 };
    // 左上角 (100,100) 落在本屏左侧，应被跳过；右下角 (300,200) 在窗内
    expect(hitHandleIn(sel, origin, { x: 300 - 250, y: 200 }, { width: 300, height: 300 })).toBe('se');
    expect(hitHandleIn(sel, origin, { x: 100 - 250, y: 100 }, { width: 300, height: 300 })).toBeNull();
  });
});

describe('边框命中', () => {
  it('角优先于边，边中段返回对应方向', () => {
    expect(hitBorder(sel, { x: 100, y: 100 })).toBe('nw');
    expect(hitBorder(sel, { x: 200, y: 101 })).toBe('n');
    expect(hitBorder(sel, { x: 301, y: 150 })).toBe('e');
  });

  it('离边框远于阈值时不命中', () => {
    expect(hitBorder(sel, { x: 200, y: 150 })).toBeNull();
  });
});

describe('移动与夹取', () => {
  it('moveRect 按位移平移，不改尺寸', () => {
    expect(moveRect(sel, { x: 0, y: 0 }, { x: 10, y: -5 })).toEqual({ ...sel, x: 110, y: 95 });
  });

  it('clampRect 把越界选区贴回边界内', () => {
    const bounds: Rect = { x: 0, y: 0, width: 500, height: 400 };
    expect(clampRect({ x: -30, y: 390, width: 100, height: 50 }, bounds)).toEqual({
      x: 0,
      y: 350,
      width: 100,
      height: 50,
    });
  });

  it('pointInRect 包含边界', () => {
    expect(pointInRect(sel, { x: 300, y: 200 })).toBe(true);
    expect(pointInRect(sel, { x: 301, y: 200 })).toBe(false);
  });
});

describe('resizeRect', () => {
  it('拖东边只改右边界，左边固定', () => {
    expect(resizeRect(sel, 'e', { x: 350, y: 0 })).toEqual({ x: 100, y: 100, width: 250, height: 100 });
  });

  it('反向拖动翻转，宽度不为负且不小于最小边长', () => {
    const r = resizeRect(sel, 'w', { x: 400, y: 100 });
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.x).toBeLessThanOrEqual(sel.x + sel.width - 1);
  });
});
