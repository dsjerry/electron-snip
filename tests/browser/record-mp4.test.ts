import { describe, expect, it } from 'vitest';
import { buildMp4 } from '../../src/record/mp4';
import type { StoredFrame } from '../../src/record/pipeline';
import { inspectMp4 } from '../helpers/mp4-parse';

/** 环境没有 H.264 编码器（如无 VideoToolbox 的 headless）就跳过，不算失败 */
async function skipWithoutH264(ctx: { skip(): void }): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') {
    ctx.skip();
    return true;
  }
  const support = await VideoEncoder.isConfigSupported({
    codec: 'avc1.42001E',
    width: 64,
    height: 48,
    bitrate: 1_000_000,
    framerate: 10,
  });
  if (!support.supported) {
    ctx.skip();
    return true;
  }
  return false;
}

/** 纯色帧：帧间颜色变化能逼出真实的帧间编码 */
function frames(width: number, height: number, count: number): StoredFrame[] {
  const out: StoredFrame[] = [];
  for (let i = 0; i < count; i++) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < pixels.length; p += 4) {
      pixels[p] = (i * 40) % 256;
      pixels[p + 1] = (i * 80) % 256;
      pixels[p + 2] = 128;
      pixels[p + 3] = 255;
    }
    out.push({ pixels, at: i * 100 });
  }
  return out;
}

describe('MP4 编码（真实 WebCodecs）', () => {
  it('偶数尺寸：产出结构自洽的 MP4', async (ctx) => {
    if (await skipWithoutH264(ctx)) return;
    const mp4 = await buildMp4(64, 48, frames(64, 48, 6), 600);
    const info = inspectMp4(mp4);
    expect(info.topLevelTypes).toEqual(['ftyp', 'moov', 'mdat']);
    expect(info.tkhdWidth).toBe(64);
    expect(info.tkhdHeight).toBe(48);
    expect(info.sizes).toHaveLength(6);
    expect(info.avcC.length).toBeGreaterThan(0);
    expect(info.mdatEnd - info.mdatStart).toBe(info.sizes.reduce((n, s) => n + s, 0));
    expect(info.stcoOffset).toBe(info.mdatStart);
    expect(info.mdhdDuration).toBe(600);
    // 默认关键帧间隔 2s：600ms 里只有首帧是关键帧（1 起），其余靠帧间压缩
    expect(info.keySamples).toEqual([1]);
  });

  it('奇数尺寸：补边编码后显示尺寸为偶数', async (ctx) => {
    if (await skipWithoutH264(ctx)) return;
    const mp4 = await buildMp4(65, 47, frames(65, 47, 3), 300);
    const info = inspectMp4(mp4);
    expect(info.tkhdWidth).toBe(66);
    expect(info.tkhdHeight).toBe(48);
    expect(info.sizes).toHaveLength(3);
  });
});
