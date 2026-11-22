import { describe, expect, it } from 'vitest';
import { muxAvcMp4, type Mp4Sample } from '../src/record/mp4-muxer';
import { inspectMp4 } from './helpers/mp4-parse';

/** 假的 avcC 配置记录：封装器原样内嵌进 avcC 盒，内容是什么不影响结构 */
const avcC = Uint8Array.from([
  0x01, 0x42, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x02, 0x67, 0x42, 0x01, 0x01, 0x01, 0x00, 0x04, 0x68, 0xca, 0x80,
]);

function sample(size: number, durationMs: number, keyFrame: boolean): Mp4Sample {
  return { data: Uint8Array.from({ length: size }, (_, i) => (i + size) % 251), durationMs, keyFrame };
}

describe('MP4 封装：结构自洽', () => {
  it('单关键帧：盒层级完整，偏移与采样表一致', () => {
    const samples = [sample(64, 200, true)];
    const u8 = muxAvcMp4({ width: 320, height: 200, avcC, samples });
    const info = inspectMp4(u8);

    // 顶层顺序即 faststart：moov 必须在 mdat 之前
    expect(info.topLevelTypes).toEqual(['ftyp', 'moov', 'mdat']);
    expect(info.mvhdTimescale).toBe(1000);
    expect(info.mvhdDuration).toBe(200);
    expect(info.tkhdTrackId).toBe(1);
    expect(info.tkhdDuration).toBe(200);
    expect(info.tkhdWidth).toBe(320);
    expect(info.tkhdHeight).toBe(200);
    expect(info.mdhdTimescale).toBe(1000);
    expect(info.mdhdDuration).toBe(200);
    expect(info.stsdEntryCount).toBe(1);
    expect(info.avcC).toEqual(avcC);

    expect(info.sttsRuns).toEqual([{ count: 1, delta: 200 }]);
    // 全部都是关键帧：省略 stss，规范里缺省即「全部同步」
    expect(info.keySamples).toEqual([]);
    expect(info.stsc).toEqual({ count: 1, firstChunk: 1, samplesPerChunk: 1 });
    expect(info.stszSampleSize).toBe(0);
    expect(info.sizes).toEqual([64]);

    // stco 指向 mdat 载荷起点：ftyp + moov 盒 + mdat 盒头
    expect(info.stcoOffset).toBe(info.mdatStart);
    expect(info.mdatStart).toBe(info.boxes[0].size + info.boxes[1].size + 8);
    expect(info.mdatEnd - info.mdatStart).toBe(64);
  });

  it('混合关键帧：stss 记录关键帧样本号，stts 合并相同间隔', () => {
    const samples = [
      sample(100, 100, true),
      sample(20, 100, false),
      sample(20, 50, false),
      sample(30, 50, false),
      sample(15, 200, true),
    ];
    const u8 = muxAvcMp4({ width: 640, height: 360, avcC, samples });
    const info = inspectMp4(u8);

    expect(info.sttsRuns).toEqual([
      { count: 2, delta: 100 },
      { count: 2, delta: 50 },
      { count: 1, delta: 200 },
    ]);
    // 关键帧是第 1、5 个样本（1 起）
    expect(info.keySamples).toEqual([1, 5]);
    expect(info.mdhdDuration).toBe(500);
    expect(info.sizes).toEqual([100, 20, 20, 30, 15]);
    expect(info.stcoOffset).toBe(info.mdatStart);
    expect(info.mdatEnd - info.mdatStart).toBe(185);
  });

  it('全零开头的采样数据不会被当成盒边界：mdat 逐字节可读回', () => {
    const data = new Uint8Array(48); // 全 0：解析器靠长度字段走盒，不靠内容猜
    const u8 = muxAvcMp4({ width: 100, height: 50, avcC, samples: [{ data, durationMs: 40, keyFrame: true }] });
    const info = inspectMp4(u8);
    expect(info.sizes).toEqual([48]);
    expect(info.mdatEnd - info.mdatStart).toBe(48);
  });

  it('非法输入直接报错，不写出残缺文件', () => {
    expect(() => muxAvcMp4({ width: 0, height: 4, avcC, samples: [sample(8, 10, true)] })).toThrow('MP4 宽度非法');
    expect(() => muxAvcMp4({ width: 4, height: 0, avcC, samples: [sample(8, 10, true)] })).toThrow('MP4 高度非法');
    expect(() => muxAvcMp4({ width: 4, height: 4, avcC, samples: [] })).toThrow('MP4 没有采样');
    expect(() => muxAvcMp4({ width: 4, height: 4, avcC: new Uint8Array(0), samples: [sample(8, 10, true)] })).toThrow(
      'MP4 缺少 avcC 配置',
    );
    expect(() => muxAvcMp4({ width: 4, height: 4, avcC, samples: [sample(8, 0, true)] })).toThrow('MP4 采样时长非法');
    expect(() =>
      muxAvcMp4({ width: 4, height: 4, avcC, samples: [{ data: new Uint8Array(0), durationMs: 10, keyFrame: true }] }),
    ).toThrow('MP4 采样为空');
  });
});
