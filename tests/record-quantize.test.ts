import { describe, expect, it } from 'vitest';
import { dedupeFrames, quantize } from '../src/record/quantize';

/** RGBA 帧：每个像素 4 字节 */
function rgba(width: number, height: number, pick: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pick(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** 按索引还原 RGB，用来衡量量化误差 */
function reconstruct(
  q: ReturnType<typeof quantize>,
  frameIndex: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const idx = q.frames[frameIndex].indices;
  for (let p = 0; p < width * height; p++) {
    const c = idx[p];
    out[p * 4] = q.rgb[c * 3];
    out[p * 4 + 1] = q.rgb[c * 3 + 1];
    out[p * 4 + 2] = q.rgb[c * 3 + 2];
    out[p * 4 + 3] = 255;
  }
  return out;
}

function meanAbsError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return sum / n;
}

describe('颜色量化（中位切分）', () => {
  it('颜色数不超过调色板上限时，还原误差为零', () => {
    const w = 16;
    const h = 16;
    const frame = rgba(w, h, (x) => (x < 8 ? [255, 0, 0] : [0, 0, 255]));
    const q = quantize([frame], w, h);
    expect(q.size).toBeGreaterThanOrEqual(2);
    expect(q.size & (q.size - 1)).toBe(0); // 2 的幂
    expect(meanAbsError(frame, reconstruct(q, 0, w, h))).toBeLessThan(1);
  });

  it('大量颜色时调色板不超过 256，且误差可控', () => {
    const w = 64;
    const h = 64;
    const frame = rgba(w, h, (x, y) => [(x * 4) & 255, (y * 4) & 255, ((x + y) * 2) & 255]);
    const q = quantize([frame], w, h);
    expect(q.size).toBeLessThanOrEqual(256);
    expect(q.rgb.length).toBe(q.size * 3);
    expect(meanAbsError(frame, reconstruct(q, 0, w, h))).toBeLessThan(12);
  });

  it('多帧共用一张全局调色板，帧数不变', () => {
    const w = 8;
    const h = 8;
    const a = rgba(w, h, () => [10, 20, 30]);
    const b = rgba(w, h, () => [200, 210, 220]);
    const q = quantize([a, b], w, h);
    expect(q.frames).toHaveLength(2);
    expect(q.frames[0].indices.length).toBe(w * h);
    // 两帧各自的颜色都必须能从同一张表里还原
    expect(meanAbsError(a, reconstruct(q, 0, w, h))).toBeLessThan(2);
    expect(meanAbsError(b, reconstruct(q, 1, w, h))).toBeLessThan(2);
  });
});

describe('相同帧去重', () => {
  it('连续相同的帧合并，延时累加', () => {
    const f = { indices: Uint8Array.from([1, 2, 3, 4]) };
    const g = { indices: Uint8Array.from([4, 3, 2, 1]) };
    const out = dedupeFrames([f, f, f, g], [100, 100, 100, 100]);
    expect(out).toHaveLength(2);
    expect(out[0].delay).toBe(300);
    expect(out[1].delay).toBe(100);
  });

  it('间隔低于 10ms 的帧按 10ms 计，避免 GIF 延时为 0', () => {
    const f = { indices: Uint8Array.from([1]) };
    const out = dedupeFrames([f], [1]);
    expect(out[0].delay).toBe(10);
  });

  it('非相邻的重复不合并（只合并连续帧）', () => {
    const f = { indices: Uint8Array.from([1, 1]) };
    const g = { indices: Uint8Array.from([2, 2]) };
    const out = dedupeFrames([f, g, f], [50, 50, 50]);
    expect(out).toHaveLength(3);
  });
});
