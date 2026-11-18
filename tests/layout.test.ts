import { describe, expect, it } from 'vitest';
import { bestRegionOnDisplay, displayAt } from '../src/shared/geometry';
import { computePinLayout, PIN_SHADOW_PAD } from '../src/shared/pin-layout';
import type { Rect } from '../src/shared/types';

// 两块并排的屏：左 0..1000，右 1000..2000（高度 800）
const displays = [
  { bounds: { x: 0, y: 0, width: 1000, height: 800 } },
  { bounds: { x: 1000, y: 0, width: 1000, height: 800 } },
];

describe('displayAt', () => {
  it('左闭右开：落在边界上的点归右边那块屏', () => {
    expect(displayAt(displays, { x: 999, y: 10 }).bounds.x).toBe(0);
    expect(displayAt(displays, { x: 1000, y: 10 }).bounds.x).toBe(1000);
  });

  it('都不包含时退回第一块屏', () => {
    expect(displayAt(displays, { x: -50, y: -50 }).bounds.x).toBe(0);
  });
});

describe('bestRegionOnDisplay', () => {
  const shots = displays.map((d) => ({ bounds: d.bounds }));

  it('选区跨屏时取交集面积最大的那块', () => {
    const pick = bestRegionOnDisplay(shots, { x: 900, y: 100, width: 300, height: 200 });
    expect(pick?.index).toBe(1);
    expect(pick?.region).toEqual({ x: 1000, y: 100, width: 200, height: 200 });
  });

  it('与任何屏都不相交返回 null', () => {
    expect(bestRegionOnDisplay(shots, { x: 5000, y: 5000, width: 10, height: 10 })).toBeNull();
  });
});

describe('computePinLayout', () => {
  it('远离屏幕边缘时四边都留满阴影留白，图像位置等于选区', () => {
    const sel: Rect = { x: 300, y: 200, width: 400, height: 300 };
    const { bounds, padding } = computePinLayout(sel, displays);
    expect(padding).toEqual({
      left: PIN_SHADOW_PAD,
      right: PIN_SHADOW_PAD,
      top: PIN_SHADOW_PAD,
      bottom: PIN_SHADOW_PAD,
    });
    expect(bounds.x + padding.left).toBe(sel.x);
    expect(bounds.y + padding.top).toBe(sel.y);
    expect(bounds.width).toBe(sel.width + PIN_SHADOW_PAD * 2);
  });

  it('贴着屏幕左边缘的那一侧留白为 0', () => {
    const sel: Rect = { x: 0, y: 200, width: 400, height: 300 };
    const { padding, bounds } = computePinLayout(sel, displays);
    expect(padding.left).toBe(0);
    expect(bounds.x).toBe(0);
  });

  it('跨屏选区的分界线内侧仍有留白（留白只看所在屏的剩余空间）', () => {
    const sel: Rect = { x: 900, y: 200, width: 200, height: 300 };
    const { padding } = computePinLayout(sel, displays);
    expect(padding.left).toBe(PIN_SHADOW_PAD);
    expect(padding.right).toBe(PIN_SHADOW_PAD);
  });

  it('过小的选区按最小尺寸撑开', () => {
    const { bounds } = computePinLayout({ x: 10, y: 10, width: 5, height: 5 }, displays);
    expect(bounds.width).toBeGreaterThanOrEqual(120);
    expect(bounds.height).toBeGreaterThanOrEqual(90);
  });
});
