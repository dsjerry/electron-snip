import { describe, expect, it } from 'vitest';
import { encodeGif, type GifFrame, type Palette } from '../src/record/gif';
import { decodeLzw } from '../src/record/gif-decode';

/**
 * 独立的最小 GIF 解析器（只认本编码器会写的结构），用来做往返校验：
 * 编码出的字节，按 GIF89a 规范读回来，索引与延时必须一致。
 * 解析器自己也是按规范写的，不复用编码端的任何逻辑。
 */
interface ParsedFrame {
  delayMs: number;
  indices: Uint8Array;
}

function parseGif(buf: Buffer): { width: number; height: number; loops: number | null; frames: ParsedFrame[] } {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (i: number) => u8[i] | (u8[i + 1] << 8);
  expect(String.fromCharCode(...u8.subarray(0, 6))).toBe('GIF89a');
  const width = u16(6);
  const height = u16(8);
  const packed = u8[10];
  let p = 13;
  if (packed & 0x80) p += 3 * 2 ** ((packed & 7) + 1);

  const readSubBlocks = (): Uint8Array => {
    const parts: number[] = [];
    for (;;) {
      const n = u8[p++];
      if (n === 0) break;
      for (let k = 0; k < n; k++) parts.push(u8[p++]);
    }
    return Uint8Array.from(parts);
  };

  let loops: number | null = null;
  let pendingDelay = 0;
  const frames: ParsedFrame[] = [];
  while (p < u8.length) {
    const tag = u8[p++];
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = u8[p++];
      if (label === 0xff) {
        // NETSCAPE 扩展：子块形如 [11] "NETSCAPE2.0" [03] 01 lo hi 00
        const block = readSubBlocks();
        if (String.fromCharCode(...block.subarray(0, 11)) === 'NETSCAPE2.0') {
          loops = block[12] | (block[13] << 8);
        }
      } else if (label === 0xf9) {
        const size = u8[p++];
        expect(size).toBe(4);
        pendingDelay = u16(p + 1) * 10;
        p += size;
        expect(u8[p++]).toBe(0);
      } else {
        readSubBlocks();
      }
    } else if (tag === 0x2c) {
      const w = u16(p + 4);
      const h = u16(p + 6);
      const imgPacked = u8[p + 8];
      p += 9;
      expect(imgPacked & 0x80).toBe(0); // 本编码器使用全局调色板
      const minCode = u8[p++];
      const lzw = readSubBlocks();
      const decoded = decodeLzw(lzw, minCode, w * h);
      expect(decoded.ended).toBe('eoi');
      frames.push({ delayMs: pendingDelay, indices: decoded.indices });
      pendingDelay = 0;
      expect(w).toBe(width);
      expect(h).toBe(height);
    } else {
      throw new Error(`未知块标记 0x${tag.toString(16)} @ ${p - 1}`);
    }
  }
  return { width, height, loops, frames };
}

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
