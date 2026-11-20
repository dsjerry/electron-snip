import { describe, expect, it } from 'vitest';
import { placeBar } from '../src/shared/placement';

const display = { x: 0, y: 0, width: 1000, height: 800 };
const size = { width: 400, height: 90 };

describe('placeBar：控制条落位', () => {
  it('默认贴选区下方并水平居中', () => {
    const r = placeBar({ x: 300, y: 100, width: 400, height: 200 }, display, size);
    expect(r.y).toBe(100 + 200 + 12);
    expect(r.x).toBe(300 + 200 - 200);
  });

  it('下方放不下时翻到选区上方', () => {
    const r = placeBar({ x: 300, y: 500, width: 400, height: 250 }, display, size);
    expect(r.y).toBe(500 - 90 - 12);
  });

  it('上下都放不下时贴屏底（离底 8px）', () => {
    const r = placeBar({ x: 300, y: 30, width: 400, height: 760 }, display, size);
    expect(r.y).toBe(800 - 90 - 8);
  });

  it('水平越界时夹回屏内（离边 8px）', () => {
    const left = placeBar({ x: -50, y: 100, width: 40, height: 40 }, display, size);
    expect(left.x).toBe(8);
    const right = placeBar({ x: 950, y: 100, width: 40, height: 40 }, display, size);
    expect(right.x).toBe(1000 - 400 - 8);
  });

  it('副屏负坐标：以显示器原点为基准', () => {
    const second = { x: -1080, y: -329, width: 1080, height: 1920 };
    const r = placeBar({ x: -900, y: -200, width: 300, height: 100 }, second, size);
    expect(r.x).toBeGreaterThanOrEqual(-1080 + 8);
    expect(r.x + r.width).toBeLessThanOrEqual(0 - 8);
  });
});
