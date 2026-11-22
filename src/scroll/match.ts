/**
 * 长图拼接的纯匹配逻辑（无 DOM / 无 IPC），便于单元测试复现重复内容。
 * 控制条（scroll.ts）只负责把帧与累积缓冲交给这里，再决定追加哪些行。
 *
 * 对齐模型的三个关键件（对照业界做法补齐的）：
 * - **高方差探针**：探针行按行内方差挑选（签名 64 列的离散度）—— 纯色 /
 *   低对比行的签名是平的，在重复内容（表格、消息流、feed）里处处「完美
 *   匹配」，是拼重 / 跳段的头号来源；只拿高对比行做锚，歧义大幅缩小。
 * - **广义探针**：探针行不必连续，相对锚点的偏移随行带走 —— 对齐时每行
 *   与新帧的 `t + offset` 行比较，追加起点只依赖锚点行号。
 * - **双探针互证**：第二个探针取自更靠上的另一段高方差行，在对齐结果
 *   预测的位置再验一次。单一探针在重复内容里会命中假位置；两段独立
 *   内容同时在预测位置吻合，基本排除拼重。
 */

/** 行指纹的采样列数：匹配成本 O(搜索位置 × 探针行数 × 64)，几十毫秒内完成 */
export const SIG_COLS = 64;
/** 平均行差超过它视为未对上（丢帧），避免把动画中间帧拼进去 */
export const MATCH_THRESHOLD = 10;
/** 探针行数：从候选带里按方差挑出的锚行数量 */
export const PROBE_ROWS = 24;
/** 探针候选带的宽度（行）：方差挑选的搜索范围，也决定探针的最大相对偏移 */
export const PROBE_SPAN = 80;
/**
 * 相邻两帧低于它（每通道均值）视为「画面稳定」。抓稳后才拼接是自动滚动的
 * 根基：注入一步滚轮后原生应用常带一小段平滑滚动动画，中间帧既对不准也
 * 不该追加；手动模式同样受益 —— 运动帧本来就对不上，先挡掉省一次全帧搜索。
 */
export const STABLE_EPSILON = 2;
/**
 * 吸底固定带的行差判定阈值：相邻两帧同一屏幕行的签名差低于它视为「该行
 * 没动」。运动帧里底部连续没动的行 = 固定 UI（吸底工具条、贴底加载条）。
 */
export const STATIC_ROW_EPSILON = 1.5;

/**
 * 相邻两帧的采样像素差（0~255，每通道均值）。横纵按 `sample` 隔行取点，
 * 1080p 一帧约 8 万采样点，亚毫秒级 —— 每帧都要做，必须便宜。
 * 返回值 ≤ STABLE_EPSILON 即认为画面稳定，可以拼接。
 */
export function frameDiff(
  prev: Uint8ClampedArray,
  cur: Uint8ClampedArray,
  width: number,
  height: number,
  sample = 4,
): number {
  let sum = 0;
  let n = 0;
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += sample) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x += sample) {
      const i = row + x * 4;
      sum += Math.abs(prev[i] - cur[i]) + Math.abs(prev[i + 1] - cur[i + 1]) + Math.abs(prev[i + 2] - cur[i + 2]);
      n += 3;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** 单行指纹：64 列、每列横向取 3 像素均值的亮度。 */
export function rowSig(data: Uint8ClampedArray, row: number, width: number): Float32Array {
  const sig = new Float32Array(SIG_COLS);
  const base = row * width * 4;
  const step = width / SIG_COLS;
  for (let c = 0; c < SIG_COLS; c++) {
    let sum = 0;
    for (let k = -1; k <= 1; k++) {
      const x = Math.max(0, Math.min(width - 1, Math.round((c + 0.5) * step) + k)) * 4;
      const i = base + x;
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    sig[c] = sum / 3;
  }
  return sig;
}

/** 行签名的方差：衡量一行的「可匹配性」。纯色 / 渐变行的方差接近 0，文字 / 边缘行显著更大。 */
export function sigVariance(sig: Float32Array): number {
  let mean = 0;
  for (let c = 0; c < SIG_COLS; c++) mean += sig[c];
  mean /= SIG_COLS;
  let v = 0;
  for (let c = 0; c < SIG_COLS; c++) {
    const d = sig[c] - mean;
    v += d * d;
  }
  return v / SIG_COLS;
}

/** 累积缓冲的只读视图：像素、宽高与每行签名。 */
export interface AccView {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  sigs: Float32Array[];
}

/** 探针：一组高方差行，`offsets` 是相对锚点行的偏移（升序，含 0）。 */
export interface Probe {
  /** 锚点行（累积缓冲行号，探针中最小者） */
  anchor: number;
  /** 最大相对偏移（对齐搜索的右边界约束） */
  span: number;
  /** 选中的相对偏移（升序） */
  offsets: number[];
}

/**
 * 从累积缓冲 [end - span, end) 里挑 `count` 个方差最高的行做探针。
 * 挑选只看方差，相邻行可以同时入选（等于连续探针，退化安全）。
 * `end` 是累积缓冲的**内容区**末尾（调用方先扣除吸底固定带）。
 */
export function selectProbe(sigs: Float32Array[], end: number, span: number, count: number): Probe {
  const start = Math.max(0, end - span);
  const candidates: { row: number; variance: number }[] = [];
  for (let r = start; r < end; r++) candidates.push({ row: r, variance: sigVariance(sigs[r]) });
  candidates.sort((a, b) => b.variance - a.variance);
  const picked = candidates
    .slice(0, Math.min(count, candidates.length))
    .map((c) => c.row)
    .sort((a, b) => a - b);
  const anchor = picked[0];
  const offsets = picked.map((r) => r - anchor);
  return { anchor, span: offsets[offsets.length - 1], offsets };
}

/** 探针在新帧 t 处的签名差：探针行 anchor+offset 对齐到 t+offset，逐行求签名差均值。 */
export function probeDiffAt(t: number, probe: Probe, acc: AccView, stripSigs: Float32Array[]): number {
  let sum = 0;
  for (const off of probe.offsets) {
    const a = acc.sigs[probe.anchor + off];
    const b = stripSigs[t + off];
    let d = 0;
    for (let c = 0; c < SIG_COLS; c++) d += Math.abs(a[c] - b[c]);
    sum += d / SIG_COLS;
  }
  return sum / probe.offsets.length;
}

/**
 * 探针的实际像素版本（逐 2 列采样，RGB 差均值）—— 行签名是均值指纹，
 * 有量化噪声；接缝处差 1 行肉眼可见，最后用它在 ±2 行内做精确定位。
 */
export function probeDiffFull(t: number, probe: Probe, acc: AccView, strip: Uint8ClampedArray): number {
  const rowBytes = acc.width * 4;
  let sum = 0;
  let n = 0;
  for (const off of probe.offsets) {
    const aRow = (probe.anchor + off) * rowBytes;
    const bRow = (t + off) * rowBytes;
    for (let x = 0; x < acc.width; x += 2) {
      const i = aRow + x * 4;
      const j = bRow + x * 4;
      sum +=
        Math.abs(acc.data[i] - strip[j]) +
        Math.abs(acc.data[i + 1] - strip[j + 1]) +
        Math.abs(acc.data[i + 2] - strip[j + 2]);
      n += 3;
    }
  }
  return n > 0 ? sum / n : Infinity;
}

/**
 * 在新帧里定位探针，返回对位点 bestT（探针锚点行在新帧的行号）与平均行差。
 * 三遍：签名全局最小 → 最小+2 容差内取最小 t（抗抖动）→ ±2 行像素精修。
 * 搜索上限 `limit`：t + probe.span 不能越过帧的内容区（调用方扣除固定带）。
 */
export function alignFrame(
  acc: AccView,
  probe: Probe,
  strip: Uint8ClampedArray,
  stripSigs: Float32Array[],
  limit: number,
): { bestT: number; best: number } {
  // t + probe.span 是探针最深的行号，必须留在内容区（limit-1）之内
  const last = Math.max(0, limit - 1 - probe.span);
  const diffs: number[] = [];
  let minDiff = Infinity;
  for (let t = 0; t <= last; t++) {
    const d = probeDiffAt(t, probe, acc, stripSigs);
    diffs.push(d);
    if (d < minDiff) minDiff = d;
  }
  if (diffs.length === 0) return { bestT: 0, best: Infinity };
  let pick = diffs.length - 1;
  for (let t = 0; t < diffs.length; t++) {
    if (diffs[t] <= minDiff + 2) {
      pick = t;
      break;
    }
  }
  let fine = pick;
  let fineBest = Infinity;
  for (let t = Math.max(0, pick - 2); t <= Math.min(pick + 2, last); t++) {
    const d = probeDiffFull(t, probe, acc, strip);
    if (d < fineBest) {
      fineBest = d;
      fine = t;
    }
  }
  return { bestT: fine, best: fineBest };
}

/**
 * 次探针互证：第二段高方差行（更靠上的内容）按与主探针的相对位置预测出
 * 它在新帧的位置，差值低于阈值才算通过。重复内容里主探针会命中假位置，
 * 次探针是另一段独立内容，假位置几乎不可能同时吻合。
 * 返回 false = 互证失败（调用方按失配丢帧处理）。
 */
export function verifyProbe(
  acc: AccView,
  main: Probe,
  secondary: Probe,
  bestT: number,
  stripSigs: Float32Array[],
  threshold: number,
): boolean {
  // 次探针锚点比主探针靠上 (main.anchor - secondary.anchor) 行：
  // 主探针对上 bestT，次探针就应对上 bestT - (main.anchor - secondary.anchor)
  const t2 = bestT - (main.anchor - secondary.anchor);
  if (t2 < 0) return true; // 预测位置越出帧顶：帧里看不到次探针，无法互证，放行
  return probeDiffAt(t2, secondary, acc, stripSigs) <= threshold;
}

/**
 * 新帧对位后，应从帧的哪一行起追加到累积缓冲（以及追加多少行）。
 * 探针锚点行 anchor 对上了新帧 bestT 行；累积缓冲的内容末尾 `contentBottom`
 * 对应新帧的 bestT + (contentBottom - anchor)，之后（到帧的内容区末尾
 * `contentHeight`）才是真正的新内容。吸底固定带不在追加范围内。
 */
export function appendRange(
  contentBottom: number,
  anchor: number,
  bestT: number,
  contentHeight: number,
): { start: number; rows: number } {
  const start = bestT + (contentBottom - anchor);
  return { start, rows: Math.max(0, contentHeight - start) };
}

/**
 * 估计吸底固定带的高度：对比相邻两帧（必须是**运动帧对** —— 静止帧分不清
 * 「没滚」和「全是固定 UI」），从底部向上数签名差 ≤ STATIC_ROW_EPSILON 的行。
 * 页面滚过一步时，固定 UI 的行原封不动，内容行全部移位，两者由此区分。
 * 返回值由调用方做平滑（宁可比真值大：多扣的行下一帧视口还盖得住，会补回来；
 * 少扣则会把固定带反复拼进长图，错误不可自愈）。
 */
export function estimateStickyBottom(
  prev: Uint8ClampedArray,
  cur: Uint8ClampedArray,
  width: number,
  height: number,
  cap: number,
): number {
  const limit = Math.min(cap, Math.floor(height / 3));
  let n = 0;
  for (let i = 0; i < limit; i++) {
    const row = height - 1 - i;
    const a = rowSig(prev, row, width);
    const b = rowSig(cur, row, width);
    let d = 0;
    for (let c = 0; c < SIG_COLS; c++) d += Math.abs(a[c] - b[c]);
    if (d / SIG_COLS > STATIC_ROW_EPSILON) break;
    n += 1;
  }
  return n;
}
