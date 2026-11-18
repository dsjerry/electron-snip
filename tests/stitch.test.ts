import { describe, expect, it } from 'vitest';
import { planStitch } from '../src/shared/stitch';
import type { DisplayShot } from '../src/shared/types';

function shot(bounds: DisplayShot['bounds'], scale: number): DisplayShot {
  return {
    displayId: bounds.x,
    bounds,
    scaleX: scale,
    scaleY: scale,
    imageWidth: Math.round(bounds.width * scale),
    imageHeight: Math.round(bounds.height * scale),
    pixels: new Uint8Array(0),
  };
}

describe('planStitch', () => {
  it('输出尺寸 = 选区 × outScale，四舍五入', () => {
    const plan = planStitch({
      shots: [],
      selection: { x: 0, y: 0, width: 200, height: 100.4 },
      outScale: 1.5,
    });
    expect(plan.width).toBe(300);
    expect(plan.height).toBe(151);
  });

  it('相邻两屏共享的边在输出里零缝隙（不同缩放比例）', () => {
    const left = shot({ x: 0, y: 0, width: 100, height: 100 }, 1.5);
    const right = shot({ x: 100, y: 0, width: 200, height: 100 }, 2);
    const plan = planStitch({
      shots: [left, right],
      selection: { x: 50, y: 0, width: 200, height: 100 },
      outScale: 2,
    });
    const [a, b] = plan.ops;
    expect(a.dst.x + a.dst.width).toBe(b.dst.x);
    expect(a.dst.x).toBe(0);
    expect(b.dst.x + b.dst.width).toBe(plan.width);
  });

  it('扫描多种选区起点与缩放，共享边始终对齐（防止 ±1 像素缝）', () => {
    for (const outScale of [1, 1.25, 1.5, 1.75, 2]) {
      for (let sx = 0; sx < 60; sx += 7) {
        for (const boundary of [37, 100, 101, 143]) {
          const left = shot({ x: 0, y: 0, width: boundary, height: 80 }, 1.25);
          const right = shot({ x: boundary, y: 0, width: 240 - boundary, height: 80 }, 1.25);
          const plan = planStitch({
            shots: [left, right],
            selection: { x: sx, y: 0, width: 240 - sx, height: 80 },
            outScale,
          });
          if (sx >= boundary) continue;
          expect(plan.ops).toHaveLength(2);
          const [a, b] = plan.ops;
          expect(a.dst.x + a.dst.width).toBe(b.dst.x);
        }
      }
    }
  });

  it('与选区不相交的屏被跳过', () => {
    const far = shot({ x: 1000, y: 0, width: 100, height: 100 }, 1);
    const plan = planStitch({
      shots: [far],
      selection: { x: 0, y: 0, width: 50, height: 50 },
      outScale: 1,
    });
    expect(plan.ops).toHaveLength(0);
  });

  it('比例一致时不重采样，不一致时开启平滑', () => {
    const same = shot({ x: 0, y: 0, width: 100, height: 100 }, 2);
    const diff = shot({ x: 100, y: 0, width: 100, height: 100 }, 1);
    const plan = planStitch({
      shots: [same, diff],
      selection: { x: 0, y: 0, width: 200, height: 100 },
      outScale: 2,
    });
    expect(plan.ops[0].smooth).toBe(false);
    expect(plan.ops[1].smooth).toBe(true);
  });

  it('源矩形取自缩略图的物理像素，不超出图像边界', () => {
    const s = shot({ x: 0, y: 0, width: 100, height: 100 }, 2);
    const plan = planStitch({
      shots: [s],
      selection: { x: 0, y: 0, width: 100, height: 100 },
      outScale: 2,
    });
    const [op] = plan.ops;
    expect(op.src).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    expect(op.src.x + op.src.width).toBeLessThanOrEqual(s.imageWidth);
  });
});
