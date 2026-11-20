import { describe, expect, it } from 'vitest';
import { buildGif, type StoredFrame } from '../src/record/pipeline';
import { parseGif } from './helpers/gif-parse';

/** 纯色帧：整帧一个颜色，量化后索引必然全部相同 */
function solid(width: number, height: number, [r, g, b]: [number, number, number]): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  return px;
}

describe('buildGif：录制帧 → GIF', () => {
  const w = 6;
  const h = 4;
  const red: [number, number, number] = [255, 0, 0];
  const blue: [number, number, number] = [0, 0, 255];

  it('相邻相同的帧合并，延时累加；最后一帧延伸到结束时刻', () => {
    const frames: StoredFrame[] = [
      { pixels: solid(w, h, red), at: 0 },
      { pixels: solid(w, h, red), at: 100 }, // 与前一帧相同 → 合并
      { pixels: solid(w, h, blue), at: 200 },
    ];
    const parsed = parseGif(Buffer.from(buildGif(w, h, frames, 300)));
    expect(parsed.width).toBe(w);
    expect(parsed.height).toBe(h);
    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames[0].delayMs).toBe(200);
    expect(parsed.frames[1].delayMs).toBe(100);
  });

  it('两帧颜色不同：索引分别为各自的颜色', () => {
    const frames: StoredFrame[] = [
      { pixels: solid(w, h, red), at: 0 },
      { pixels: solid(w, h, blue), at: 100 },
    ];
    const parsed = parseGif(Buffer.from(buildGif(w, h, frames, 200)));
    expect(parsed.frames).toHaveLength(2);
    expect(new Set(parsed.frames[0].indices).size).toBe(1);
    expect(new Set(parsed.frames[1].indices).size).toBe(1);
    expect(parsed.frames[0].indices[0]).not.toBe(parsed.frames[1].indices[0]);
  });

  it('没有帧时报错，不产出空 GIF', () => {
    expect(() => buildGif(w, h, [], 100)).toThrow('没有可导出的帧');
  });
});
