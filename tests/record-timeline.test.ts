import { describe, expect, it } from 'vitest';
import { elapsedMs, frameDurations, snapshotAt } from '../src/record/timeline';

describe('snapshotAt：帧取「当时生效」的标注快照', () => {
  const snaps = [
    { at: 1000, value: 'A' },
    { at: 3000, value: 'B' },
    { at: 3000, value: 'B2' }, // 同一毫秒的两份：后到的覆盖先到的
    { at: 5000, value: 'C' },
  ];

  it('早于第一份快照时返回兜底值', () => {
    expect(snapshotAt(snaps, 500, 'none')).toBe('none');
  });

  it('落在两份之间取前一份，不提前出现', () => {
    expect(snapshotAt(snaps, 2999, 'none')).toBe('A');
    expect(snapshotAt(snaps, 4000, 'none')).toBe('B2');
  });

  it('恰好等于快照时刻即生效；同毫秒取最后一份', () => {
    expect(snapshotAt(snaps, 1000, 'none')).toBe('A');
    expect(snapshotAt(snaps, 3000, 'none')).toBe('B2');
    expect(snapshotAt(snaps, 99999, 'none')).toBe('C');
  });

  it('空时间轴返回兜底值', () => {
    expect(snapshotAt([], 10, 'none')).toBe('none');
  });
});

describe('elapsedMs：扣除暂停时长', () => {
  it('未暂停：now - start', () => {
    expect(elapsedMs(1500, 1000, 0, null)).toBe(500);
  });

  it('暂停过的时长不计入', () => {
    // 已经暂停过 300ms（pausedTotal），且当前仍在暂停中（pausedAt=1400，now=1500，又 100ms）
    expect(elapsedMs(1500, 1000, 300, 1400)).toBe(100);
  });

  it('不会返回负数', () => {
    expect(elapsedMs(1000, 1000, 500, null)).toBe(0);
  });
});

describe('frameDurations：每帧显示时长', () => {
  it('取到下一帧的间隔', () => {
    expect(frameDurations([0, 100, 250], 10)).toEqual([100, 150, 150]);
  });

  it('单帧使用 1000/fps', () => {
    expect(frameDurations([0], 10)).toEqual([100]);
  });

  it('空序列为空', () => {
    expect(frameDurations([], 10)).toEqual([]);
  });

  it('间隔至少 1ms，避免 0 延时', () => {
    expect(frameDurations([0, 0, 5], 10)[0]).toBe(1);
  });
});
