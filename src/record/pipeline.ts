import { encodeGif } from './gif';
import { dedupeFrames, quantize } from './quantize';
import { frameDurations } from './timeline';

/** 录制中保存的一帧：RGBA 像素 + 录制起点起算的时刻（毫秒，已扣除暂停） */
export interface StoredFrame {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  at: number;
}

/**
 * 把录制帧合成为 GIF89a（纯函数，不依赖 DOM）。
 *
 * - 每帧显示时长取到下一帧的间隔；最后一帧取到 `endAt`（录制结束时刻）
 * - 全片共用一张调色板，相邻相同的帧合并为一帧并累加延时
 *
 * @param endAt 录制结束时刻（毫秒）；必须不早于最后一帧
 */
export function buildGif(width: number, height: number, frames: StoredFrame[], endAt: number, loops = 0): Uint8Array {
  if (frames.length === 0) throw new Error('没有可导出的帧');
  const times = frames.map((f) => f.at);
  const end = Math.max(endAt, times[times.length - 1] + 1);
  const durations = frameDurations([...times, end], 10).slice(0, frames.length);
  const q = quantize(
    frames.map((f) => f.pixels),
    width,
    height,
  );
  const merged = dedupeFrames(q.frames, durations);
  return encodeGif(width, height, { size: q.size, rgb: q.rgb }, merged, loops);
}
