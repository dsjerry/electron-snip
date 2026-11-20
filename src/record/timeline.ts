/**
 * 录制的时间轴（纯逻辑，无 DOM / 无 IPC）。
 *
 * 时钟统一为「录制起点起算的毫秒数，已扣除暂停时长」。帧、标注快照、点击涟漪都用同一时钟，
 * 合成时才能对齐：第 5 秒画的箭头只能出现在第 5 秒之后的帧里。
 */

/** 一份标注快照：在 `at` 时刻起生效，直到下一份出现。 */
export interface TimelineSnapshot<T> {
  at: number;
  value: T;
}

/**
 * 取 t 时刻生效的快照：最后一个 `at <= t` 的那份；之前没有任何快照则返回 `fallback`。
 * 快照必须按 `at` 升序追加（录制中时间只增不减，天然满足）；这里用二分查找。
 */
export function snapshotAt<T>(snapshots: readonly TimelineSnapshot<T>[], t: number, fallback: T): T {
  let lo = 0;
  let hi = snapshots.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid].at <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? snapshots[found].value : fallback;
}

/**
 * 录制已经进行的时长（扣除暂停）。
 * `now` 与 `startedAt` 同为单调时钟（performance.now()）；`pausedAt` 非空表示当前正处于暂停中。
 */
export function elapsedMs(now: number, startedAt: number, pausedTotal: number, pausedAt: number | null): number {
  const pausedNow = pausedAt === null ? 0 : now - pausedAt;
  return Math.max(0, now - startedAt - pausedTotal - pausedNow);
}

/**
 * 由各帧的时刻推出 GIF 每帧的显示时长。
 * 帧的显示时长 = 到下一帧的间隔；最后一帧没有下一帧，沿用前一个间隔（只有一帧时用 1000/fps）。
 */
export function frameDurations(times: readonly number[], fps: number): number[] {
  if (times.length === 0) return [];
  const fallback = 1000 / fps;
  return times.map((t, i) => {
    if (i + 1 < times.length) return Math.max(1, times[i + 1] - t);
    return i > 0 ? Math.max(1, t - times[i - 1]) : fallback;
  });
}
