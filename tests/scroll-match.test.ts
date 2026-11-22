import { describe, expect, it } from 'vitest';
import {
  alignFrame,
  appendRange,
  estimateStickyBottom,
  frameDiff,
  MATCH_THRESHOLD,
  PROBE_ROWS,
  PROBE_SPAN,
  rowSig,
  selectProbe,
  sigVariance,
  STABLE_EPSILON,
  verifyProbe,
  type AccView,
} from '../src/scroll/match';

// 合成页面：每行在横向也有纹理（像真实网页的文字 / 色块），行与行的签名可区分
const W = 64;

function pixel(r: number, x: number): [number, number, number] {
  return [(r * 7 + x * 13) & 255, (r * 3 + x * 29 + (r >> 4)) & 255, (r * r + x * 5) & 255];
}

function makePage(rows: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(rows * W * 4);
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < W; x++) {
      const [R, G, B] = pixel(r, x);
      const i = (r * W + x) * 4;
      data[i] = R;
      data[i + 1] = G;
      data[i + 2] = B;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** 行内容指纹：整行像素，用来反查它在页面中的行号 */
function rowKey(data: Uint8ClampedArray, row: number): string {
  return Array.from(data.subarray(row * W * 4, (row + 1) * W * 4)).join(',');
}

/** 视口帧：页面 [top, top+h) 行的副本（与控制条收到的 RGBA 帧一样） */
function frameAt(page: Uint8ClampedArray, top: number, h: number): Uint8ClampedArray {
  return page.slice(top * W * 4, (top + h) * W * 4);
}

/**
 * 与渲染端 frame handler 同构的拼接器（纯逻辑层）：
 * 首帧等第一对运动帧才按内容区入缓冲；之后选探针对齐、互证、追加。
 * 返回当前累积缓冲（未建立时为 null —— 渲染端此状态由兜底帧导出）。
 */
function stitcher(h: number) {
  let acc: AccView | null = null;
  let prev: Uint8ClampedArray | null = null;
  let stickyF = 0;
  const cap = Math.floor(h / 3);
  const appendTo = (strip: Uint8ClampedArray, srcRow: number, count: number): void => {
    const next = new Uint8ClampedArray((acc!.height + count) * W * 4);
    next.set(acc!.data);
    next.set(strip.subarray(srcRow * W * 4, (srcRow + count) * W * 4), acc!.height * W * 4);
    acc!.data = next;
    for (let r = 0; r < count; r++) acc!.sigs.push(rowSig(strip, srcRow + r, W));
    acc!.height += count;
  };
  return {
    feed(strip: Uint8ClampedArray): AccView | null {
      const motion = prev ? frameDiff(prev, strip, W, h) : 0;
      const moving = motion > STABLE_EPSILON;
      if (moving && prev) {
        stickyF = Math.min(cap, Math.max(stickyF, estimateStickyBottom(prev, strip, W, h, cap)));
      }
      const first = prev;
      prev = strip;
      if (!acc) {
        if (!first || !moving) return null;
        acc = { data: new Uint8ClampedArray(0), width: W, height: 0, sigs: [] };
        appendTo(first, 0, h - stickyF);
      }
      const contentHeight = h - stickyF;
      const stripSigs: Float32Array[] = [];
      for (let r = 0; r < contentHeight; r++) stripSigs.push(rowSig(strip, r, W));
      const span = Math.min(PROBE_SPAN, acc.height);
      const probe = selectProbe(acc.sigs, acc.height, span, PROBE_ROWS);
      const { bestT, best } = alignFrame(acc, probe, strip, stripSigs, contentHeight);
      if (best > MATCH_THRESHOLD) return acc;
      const secEnd = acc.height - span;
      const secSpan = Math.min(PROBE_SPAN, secEnd);
      if (secSpan >= PROBE_ROWS) {
        const secondary = selectProbe(acc.sigs, secEnd, secSpan, PROBE_ROWS);
        if (!verifyProbe(acc, probe, secondary, bestT, stripSigs, MATCH_THRESHOLD)) return acc;
      }
      const { start, rows } = appendRange(acc.height, probe.anchor, bestT, contentHeight);
      if (rows > 0) appendTo(strip, start, rows);
      return acc;
    },
    get acc(): AccView | null {
      return acc;
    },
    get stickyF(): number {
      return stickyF;
    },
  };
}

/** 从累积缓冲读出每一行对应的页面行号（整行内容反查）；未知行（如固定带）直接抛错 */
function indicesOf(acc: AccView, page: Uint8ClampedArray, pageRows: number): number[] {
  const lookup = new Map<string, number>();
  for (let r = 0; r < pageRows; r++) lookup.set(rowKey(page, r), r);
  const out: number[] = [];
  for (let r = 0; r < acc.height; r++) {
    const idx = lookup.get(rowKey(acc.data, r));
    if (idx === undefined) throw new Error(`第 ${r} 行不是页面的任何一行`);
    out.push(idx);
  }
  return out;
}

/** 断言累积缓冲的行严格递增且互不重复（拼重 / 乱序都在这里现形） */
function expectStrictlyIncreasing(idx: number[]): void {
  for (let i = 1; i < idx.length; i++) {
    expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  }
  expect(new Set(idx).size).toBe(idx.length);
}

describe('长图拼接：不重复、不乱序', () => {
  const H = 300;
  const PAGE_ROWS = 1400;
  const page = makePage(PAGE_ROWS);

  it('慢速滚动：累积结果逐行对应页面，没有重复也没有缺口', () => {
    const s = stitcher(H);
    for (let top = 0; top + H <= 900; top += 30) s.feed(frameAt(page, top, H));
    const acc = s.acc!;
    const idx = indicesOf(acc, page, PAGE_ROWS);
    expect(idx).toEqual(Array.from({ length: idx.length }, (_, i) => i));
    // 最后一帧 top=870：内容覆盖到 900 行
    expect(idx.length).toBe(900);
  });

  it('页面没动时不建立累积缓冲（此状态下由兜底帧导出）', () => {
    const s = stitcher(H);
    const f = frameAt(page, 100, H);
    for (let i = 0; i < 5; i++) expect(s.feed(f)).toBeNull();
    expect(s.acc).toBeNull();
  });

  it('滚动过快导致失配时，丢帧但绝不重复写入已有内容', () => {
    // 步长大到探针带跨不进下一帧：部分帧失配被丢弃，允许出现缺口，不允许重复或乱序
    const s = stitcher(H);
    for (let top = 0; top + H <= 1000; top += 260) s.feed(frameAt(page, top, H));
    const idx = indicesOf(s.acc!, page, PAGE_ROWS);
    expectStrictlyIncreasing(idx);
  });

  it('重复内容（表格 / 消息流）：假匹配不改变拼接结果', () => {
    // 页面 400..480 与 800..880 是同一段内容 —— 新帧里的第二个副本会形成
    // 「完美匹配」假位；拼接结果必须与真实滚过的页面逐字节一致
    //（页面本身有重复段，行号反查会把它误判成乱序，所以直接比对字节）
    const page2 = makePage(PAGE_ROWS);
    page2.set(page2.slice(400 * W * 4, 480 * W * 4), 800 * W * 4);
    const s = stitcher(H);
    for (let top = 0; top + H <= 1000; top += 60) s.feed(frameAt(page2, top, H));
    const acc = s.acc!;
    // 循环边界 top + H <= 1000：最后一帧 top=660，覆盖到 960 行
    expect(acc.height).toBe(960);
    expect(Array.from(acc.data.subarray(0, 960 * W * 4))).toEqual(Array.from(page2.subarray(0, 960 * W * 4)));
  });
});

describe('吸底固定带', () => {
  const F = 40;
  const H = 300;
  const CONTENT_ROWS = 1200;
  const content = makePage(CONTENT_ROWS);

  /** 视口帧：内容 [top, top + H - F) + 底部固定带（吸底工具条，永远不变） */
  function frameWithFooter(top: number): Uint8ClampedArray {
    const frame = new Uint8ClampedArray(H * W * 4);
    frame.set(frameAt(content, top, H - F));
    for (let r = 0; r < F; r++) {
      for (let x = 0; x < W; x++) {
        const [R, G, B] = pixel(9999, x); // 与内容行都不同的「固定 UI」
        const i = ((H - F + r) * W + x) * 4;
        frame[i] = R;
        frame[i + 1] = G;
        frame[i + 2] = B;
        frame[i + 3] = 255;
      }
    }
    return frame;
  }

  it('estimateStickyBottom：运动帧对里底部没动的行被识别', () => {
    const prev = frameWithFooter(100);
    const cur = frameWithFooter(140);
    expect(estimateStickyBottom(prev, cur, W, H, Math.floor(H / 3))).toBe(F);
    // 没有固定带：底部全是滚动的内容行
    expect(estimateStickyBottom(frameAt(content, 100, H), frameAt(content, 140, H), W, H, Math.floor(H / 3))).toBe(0);
  });

  it('带吸底工具条滚动：固定带不进长图，内容完整无重复', () => {
    const s = stitcher(H);
    for (let top = 0; top + H - F <= 800; top += 30) s.feed(frameWithFooter(top));
    expect(s.stickyF).toBe(F);
    const acc = s.acc!;
    const idx = indicesOf(acc, content, CONTENT_ROWS); // 固定带混进来会在这里抛错
    expect(idx).toEqual(Array.from({ length: idx.length }, (_, i) => i));
    // 循环边界 top + (H - F) <= 800：最后一帧 top=540，内容覆盖到 800 行
    expect(idx.length).toBe(800);
  });
});

describe('探针选择与互证', () => {
  const flat = new Float32Array(64).fill(128);
  const busy = Float32Array.from({ length: 64 }, (_, c) => ((c * 37) % 11) * 20 + 40);

  it('sigVariance：纯色行接近 0，高对比行显著更大', () => {
    expect(sigVariance(flat)).toBeLessThan(1);
    expect(sigVariance(busy)).toBeGreaterThan(100);
  });

  it('selectProbe：候选带里挑方差最高的行（跳过纯色带）', () => {
    const sigs: Float32Array[] = [];
    for (let r = 0; r < 100; r++) sigs.push(r % 2 === 0 ? busy : flat);
    const probe = selectProbe(sigs, 100, 80, 24);
    expect(probe.offsets.length).toBe(24);
    // 带内 [20,100) 的偶数行全是 busy：选中的锚点行应为偶数行（acc 行号 = 锚点行）
    expect((probe.anchor + probe.offsets[0]) % 2).toBe(0);
    expect((probe.anchor + probe.offsets[23]) % 2).toBe(0);
  });

  it('verifyProbe：重复内容的假匹配被次探针否掉', () => {
    const PAGE_ROWS = 1000;
    const page = makePage(PAGE_ROWS);
    page.set(page.slice(400 * W * 4, 480 * W * 4), 800 * W * 4); // 复制一段内容
    const acc: AccView = { data: page.slice(0, 500 * W * 4), width: W, height: 500, sigs: [] };
    for (let r = 0; r < 500; r++) acc.sigs.push(rowSig(page, r, W));
    // 主探针取自重复段 [400,480)（内容区末尾），新帧是视口 [560,860)：
    // 真位置越出帧顶，帧里只有第二个副本（帧行 240 起）会「完美匹配」
    const probe = selectProbe(acc.sigs, 480, 80, PROBE_ROWS);
    // 视口 [600,900) 完整包含第二个副本 [800,880)：探针内容在帧行 200 起完美重现，
    // 真位置（页行 400 对应帧 -200 行）越出帧顶，帧里只有假位可匹配
    const strip = frameAt(page, 600, 300);
    const stripSigs: Float32Array[] = [];
    for (let r = 0; r < 300; r++) stripSigs.push(rowSig(strip, r, W));
    const { bestT, best } = alignFrame(acc, probe, strip, stripSigs, 300);
    expect(Math.abs(bestT - 200)).toBeLessThanOrEqual(3); // 命中的是第二个副本的位置
    expect(best).toBeLessThanOrEqual(MATCH_THRESHOLD);
    // 次探针来自更靠上的独立内容，在假位置不吻合 → 互证失败
    const secondary = selectProbe(acc.sigs, 320, 80, PROBE_ROWS);
    expect(verifyProbe(acc, probe, secondary, bestT, stripSigs, MATCH_THRESHOLD)).toBe(false);
  });

  it('appendRange：锚点对位后追加内容区末尾之后的新行', () => {
    // contentBottom=500，锚点行 440 对上新帧 60 行 → acc 末尾对应帧 120 行，
    // 帧内容区高 300 → 追加 [120, 300) 共 180 行
    expect(appendRange(500, 440, 60, 300)).toEqual({ start: 120, rows: 180 });
    expect(appendRange(500, 440, 60, 100)).toEqual({ start: 120, rows: 0 });
  });
});
