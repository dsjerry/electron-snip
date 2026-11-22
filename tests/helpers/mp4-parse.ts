import { expect } from 'vitest';

/**
 * 独立的最小 MP4 盒解析器（只认本封装器会写的结构），用来做结构校验：
 * 编码出的字节按 ISO BMFF 规范走一遍，盒层级、长度、偏移、采样表必须自洽。
 * 解析器自己按规范逐盒走长度，不复用封装端的任何计算。
 */

/** 容器盒：载荷里直接是子盒。值为子盒在载荷里的起始偏移（stsd/dref 载荷前有 4 字节 fullbox 头 + 4 字节 entry_count） */
const CONTAINER_HEADERS: Record<string, number> = {
  moov: 0,
  trak: 0,
  mdia: 0,
  minf: 0,
  stbl: 0,
  dinf: 0,
  stsd: 8,
  dref: 8,
};
/** avc1 是采样条目：载荷前 78 字节是 SampleEntry 头（reserved/宽高/分辨率等），之后才是子盒 */
const AVC1_HEADER = 78;

export interface Mp4Box {
  type: string;
  /** 盒总长度（含 8 字节头） */
  size: number;
  /** 盒头在文件中的起始偏移 */
  start: number;
  /** 载荷区间 [payloadStart, payloadEnd) */
  payloadStart: number;
  payloadEnd: number;
  children: Mp4Box[];
}

export function parseBoxes(u8: Uint8Array, start = 0, end = u8.length): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    const size = (u8[at] << 24) | (u8[at + 1] << 16) | (u8[at + 2] << 8) | u8[at + 3];
    const type = String.fromCharCode(u8[at + 4], u8[at + 5], u8[at + 6], u8[at + 7]);
    expect(size).toBeGreaterThanOrEqual(8);
    expect(at + size).toBeLessThanOrEqual(end);
    const box: Mp4Box = { type, size, start: at, payloadStart: at + 8, payloadEnd: at + size, children: [] };
    if (type in CONTAINER_HEADERS) {
      box.children = parseBoxes(u8, at + 8 + CONTAINER_HEADERS[type], at + size);
    } else if (type === 'avc1') {
      box.children = parseBoxes(u8, at + 8 + AVC1_HEADER, at + size);
    }
    boxes.push(box);
    at += size;
  }
  expect(at).toBe(end); // 盒必须严丝合缝铺满区间，多一个字节都不行
  return boxes;
}

/** 按路径找盒，找不到就让断言失败（fail 带路径，比 undefined 好排查） */
export function findBox(boxes: Mp4Box[], path: string[]): Mp4Box {
  let current = boxes;
  let found: Mp4Box | null = null;
  for (const type of path) {
    found = current.find((b) => b.type === type) ?? null;
    expect(found, `缺少盒 ${path.join('/')}`).not.toBeNull();
    current = found!.children;
  }
  return found!;
}

const u32 = (u8: Uint8Array, at: number): number =>
  ((u8[at] << 24) | (u8[at + 1] << 16) | (u8[at + 2] << 8) | u8[at + 3]) >>> 0;

/** 从解析结果读出封装器必须写对的字段，供测试逐项断言 */
export function inspectMp4(u8: Uint8Array) {
  const boxes = parseBoxes(u8);
  const stbl = findBox(boxes, ['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const mdhd = findBox(boxes, ['moov', 'trak', 'mdia', 'mdhd']);
  const tkhd = findBox(boxes, ['moov', 'trak', 'tkhd']);
  const mvhd = findBox(boxes, ['moov', 'mvhd']);
  const avcC = findBox(boxes, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC']);
  const mdat = boxes.find((b) => b.type === 'mdat');
  expect(mdat, '缺少 mdat').toBeDefined();

  // fullbox 的载荷以 4 字节 version+flags 开头：字段一律从 fp 起读
  const fp = (b: Mp4Box) => b.payloadStart + 4;
  const stsd = stbl.children.find((b) => b.type === 'stsd')!;
  const stts = stbl.children.find((b) => b.type === 'stts');
  const stss = stbl.children.find((b) => b.type === 'stss');
  const stsc = stbl.children.find((b) => b.type === 'stsc');
  const stsz = stbl.children.find((b) => b.type === 'stsz');
  const stco = stbl.children.find((b) => b.type === 'stco');

  const sttsRuns: { count: number; delta: number }[] = [];
  if (stts) {
    const entryCount = u32(u8, fp(stts));
    for (let i = 0; i < entryCount; i++) {
      sttsRuns.push({ count: u32(u8, fp(stts) + 4 + i * 8), delta: u32(u8, fp(stts) + 8 + i * 8) });
    }
  }
  const keySamples: number[] = [];
  if (stss) {
    const entryCount = u32(u8, fp(stss));
    for (let i = 0; i < entryCount; i++) keySamples.push(u32(u8, fp(stss) + 4 + i * 4));
  }
  const sampleCount = stsz ? u32(u8, fp(stsz) + 4) : 0;
  const sizes: number[] = [];
  if (stsz) for (let i = 0; i < sampleCount; i++) sizes.push(u32(u8, fp(stsz) + 8 + i * 4));

  return {
    boxes,
    topLevelTypes: boxes.map((b) => b.type),
    mvhdTimescale: u32(u8, fp(mvhd) + 8),
    mvhdDuration: u32(u8, fp(mvhd) + 12),
    tkhdTrackId: u32(u8, fp(tkhd) + 8),
    tkhdDuration: u32(u8, fp(tkhd) + 16),
    tkhdWidth: u32(u8, fp(tkhd) + 72) / 0x10000,
    tkhdHeight: u32(u8, fp(tkhd) + 76) / 0x10000,
    mdhdTimescale: u32(u8, fp(mdhd) + 8),
    mdhdDuration: u32(u8, fp(mdhd) + 12),
    stsdEntryCount: u32(u8, fp(stsd)),
    sttsRuns,
    keySamples,
    stsc: stsc
      ? { count: u32(u8, fp(stsc)), firstChunk: u32(u8, fp(stsc) + 4), samplesPerChunk: u32(u8, fp(stsc) + 8) }
      : null,
    stszSampleSize: stsz ? u32(u8, fp(stsz)) : null,
    sizes,
    stcoOffset: stco ? u32(u8, fp(stco) + 4) : null,
    avcC: u8.slice(avcC.payloadStart, avcC.payloadEnd),
    mdatStart: mdat!.payloadStart,
    mdatEnd: mdat!.payloadEnd,
  };
}
