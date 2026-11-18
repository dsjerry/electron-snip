import { describe, expect, it } from 'vitest';
import { intersects, resolveOutScale, unionBounds } from '../src/shared/geometry';

describe('unionBounds', () => {
  it('取所有屏的外接矩形，允许负坐标', () => {
    const u = unionBounds([
      { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
      { bounds: { x: 0, y: -200, width: 2560, height: 1440 } },
    ]);
    expect(u).toEqual({ x: -1920, y: -200, width: 4480, height: 1440 });
  });
});

describe('intersects', () => {
  it('仅共享边不算相交', () => {
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 0, width: 10, height: 10 })).toBe(true);
  });
});

describe('resolveOutScale', () => {
  const shots = [
    { bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleX: 1, scaleY: 1 },
    { bounds: { x: 100, y: 0, width: 100, height: 100 }, scaleX: 2, scaleY: 2 },
  ];

  it('取相交屏中的最大比例（放大不丢数据）', () => {
    expect(resolveOutScale(shots, { x: 50, y: 0, width: 100, height: 50 })).toBe(2);
  });

  it('只与低比例屏相交时取该屏比例', () => {
    expect(resolveOutScale(shots, { x: 0, y: 0, width: 50, height: 50 })).toBe(1);
  });

  it('不与任何屏相交时退回 1', () => {
    expect(resolveOutScale(shots, { x: 900, y: 900, width: 10, height: 10 })).toBe(1);
  });
});
