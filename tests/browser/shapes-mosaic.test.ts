import { describe, expect, it } from 'vitest';
import { drawShape } from '../../src/annotations/shapes';
import type { Shape } from '../../src/shared/types';

/**
 * 马赛克 / 模糊的绘制回归：负宽高选区与「带原点平移的远端投影」。
 * 两个都是真实用户场景 —— 马赛克向左上拖拽是日常方向；多屏时其余屏的
 * 标注靠 drawRemote 的 translate(-bounds) 补画到本屏。
 */

const W = 100;
const H = 100;

/** 对角渐变底图：像素化的块均值与原像素值必然不同，变化可断言 */
function gradientCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#000');
  g.addColorStop(1, '#fff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
}

function pixel(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number] {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}

function regionChanged(
  ctx: CanvasRenderingContext2D,
  before: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const after = ctx.getImageData(x, y, w, h).data;
  for (let i = 0; i < after.length; i++) {
    if (Math.abs(after[i] - before[i]) > 2) return true;
  }
  return false;
}

function regionSnapshot(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): Uint8ClampedArray {
  return ctx.getImageData(x, y, w, h).data.slice();
}

describe('马赛克：负宽高选区（向左上拖拽）', () => {
  it('x:40,y:25,w:-30,h:-15 规范化为 (10,10,30,15)，区域内被像素化、区域外不动', () => {
    const { ctx } = gradientCanvas();
    const inside = regionSnapshot(ctx, 12, 12, 8, 8);
    const outside = regionSnapshot(ctx, 45, 30, 8, 8);

    const shape: Shape = { type: 'mosaic', mode: 'region', x: 40, y: 25, w: -30, h: -15 };
    drawShape(ctx, shape);

    // 规范化区域内有变化（渐变被块均值取代）
    expect(regionChanged(ctx, inside, 12, 12, 8, 8)).toBe(true);
    // 区域外原样
    expect(regionChanged(ctx, outside, 45, 30, 8, 8)).toBe(false);
  });
});

describe('带原点平移的变换（远端投影 drawRemote 同款）', () => {
  it('平移 (-100,0) 下画用户坐标 (120,10,30,15)：设备区 (20..50) 被像素化', () => {
    const { ctx } = gradientCanvas();
    const deviceRegion = regionSnapshot(ctx, 22, 12, 8, 8);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, -100, 0);
    drawShape(ctx, { type: 'mosaic', mode: 'region', x: 120, y: 10, w: 30, h: 15 });
    ctx.restore();
    // 修复前：虚拟坐标被 [0, size.w] 钳制判成越界，整体画不出
    expect(regionChanged(ctx, deviceRegion, 22, 12, 8, 8)).toBe(true);
    const p = pixel(ctx, 22, 14);
    expect(p[0]).toBeGreaterThanOrEqual(0);
  });

  it('平移下画 blur：设备区高频细节被抹平（方差下降）', () => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    // 高频噪声底图：模糊后方差必然骤降
    const img = ctx.createImageData(W, H);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = (seed >>> 16) & 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const variance = (x: number, y: number, w: number, h: number): number => {
      const d = ctx.getImageData(x, y, w, h).data;
      let mean = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        mean += d[i];
        n++;
      }
      mean /= n;
      let v = 0;
      for (let i = 0; i < d.length; i += 4) v += (d[i] - mean) ** 2;
      return v / n;
    };
    const before = variance(22, 12, 8, 8);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, -100, 0);
    drawShape(ctx, { type: 'mosaic', mode: 'blur', x: 120, y: 10, w: 30, h: 15 });
    ctx.restore();
    expect(variance(22, 12, 8, 8)).toBeLessThan(before);
  });
});
