import { describe, expect, it } from 'vitest';
import { encodeGif, type GifFrame, type Palette } from '../src/record/gif';
import { parseGif } from './helpers/gif-parse';

/** 4 色调色板：黑、白、红、绿 */
const palette: Palette = {
  size: 4,
  rgb: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 0]),
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('GIF 编码往返', () => {
  it('单帧：索引与尺寸原样读回', () => {
    const w = 7;
    const h = 5;
    const indices = Uint8Array.from({ length: w * h }, (_, i) => i % 4);
    const buf = encodeGif(w, h, palette, [{ delay: 100, indices }], 0);
    const parsed = parseGif(buf);
    expect(parsed.width).toBe(w);
    expect(parsed.height).toBe(h);
    expect(parsed.frames).toHaveLength(1);
    expect(Array.from(parsed.frames[0].indices)).toEqual(Array.from(indices));
    expect(parsed.frames[0].delayMs).toBe(100);
  });

  it('多帧随机索引：每帧逐像素一致，循环次数写入 NETSCAPE 扩展', () => {
    const r = rng(42);
    const w = 64;
    const h = 40;
    const frames: GifFrame[] = [];
    for (let f = 0; f < 6; f++) {
      const indices = Uint8Array.from({ length: w * h }, () => Math.floor(r() * 4));
      frames.push({ delay: 50 + f * 10, indices });
    }
    const parsed = parseGif(encodeGif(w, h, palette, frames, 3));
    expect(parsed.loops).toBe(3);
    expect(parsed.frames).toHaveLength(frames.length);
    frames.forEach((f, i) => {
      expect(Array.from(parsed.frames[i].indices)).toEqual(Array.from(f.indices));
      expect(parsed.frames[i].delayMs).toBe(Math.max(1, Math.round(f.delay / 10)) * 10);
    });
  });

  it('大图触发 LZW 码表重置：仍能完整读回', () => {
    // 4 色随机大图会把码表填满多次，覆盖码长增长与重置分支
    const r = rng(7);
    const w = 320;
    const h = 240;
    const indices = Uint8Array.from({ length: w * h }, () => Math.floor(r() * 4));
    const parsed = parseGif(encodeGif(w, h, palette, [{ delay: 100, indices }], 0));
    expect(Array.from(parsed.frames[0].indices)).toEqual(Array.from(indices));
  });

  it('非法输入直接报错，不写出残缺文件', () => {
    expect(() => encodeGif(0, 4, palette, [{ delay: 10, indices: new Uint8Array(0) }])).toThrow('GIF 尺寸非法');
    expect(() => encodeGif(4, 4, palette, [])).toThrow('GIF 没有帧');
  });
});
