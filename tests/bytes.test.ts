import { describe, expect, it } from 'vitest';
import { toBlob, toClamped } from '../src/shared/bytes';

describe('bytes', () => {
  it('toBlob 复制数据并保留 MIME 类型', async () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const blob = toBlob(src, 'image/png');
    src[0] = 9;
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('toClamped 返回独立副本', () => {
    const src = new Uint8Array([10, 20]);
    const out = toClamped(src);
    src[0] = 99;
    expect(Array.from(out)).toEqual([10, 20]);
  });
});
