import { expect } from 'vitest';
import { decodeLzw } from '../../src/record/gif-decode';

/**
 * 独立的最小 GIF 解析器（只认本编码器会写的结构），用来做往返校验：
 * 编码出的字节，按 GIF89a 规范读回来，索引与延时必须一致。
 * 解析器自己也是按规范写的，不复用编码端的任何逻辑。
 */
export interface ParsedFrame {
  delayMs: number;
  indices: Uint8Array;
}

export function parseGif(u8: Uint8Array): {
  width: number;
  height: number;
  loops: number | null;
  frames: ParsedFrame[];
} {
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
