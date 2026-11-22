/**
 * 最小 MP4 封装器：把 H.264 采样（avc 格式，长度前缀 NALU）封进 MP4 容器。
 *
 * 只写「单视频轨 + avc1」这一种结构，时间刻度固定 1000（毫秒）—— 录制帧的
 * 时刻本来就是整数毫秒，换算无误差。moov 写在 mdat 之前（fastStart），播放器
 * 拿到头部即可起播，不必读完整个文件。
 *
 * 与 GIF 编码器同一取舍：零依赖、只认自己需要的结构。EncodedVideoChunk 的
 * avc 输出本身就是「4 字节长度前缀 + NALU」，与 MP4 采样格式一致，逐字节
 * 塞进 mdat 即可，不需要转 Annex-B。
 */

/** 一条视频采样：编码字节 + 显示时长（毫秒）+ 是否关键帧 */
export interface Mp4Sample {
  /** EncodedVideoChunk.copyTo 出来的字节（avc 格式：4 字节大端长度前缀 + NALU） */
  data: Uint8Array;
  /** 显示时长（毫秒），必须 ≥ 1 */
  durationMs: number;
  keyFrame: boolean;
}

export interface MuxAvcMp4Options {
  width: number;
  height: number;
  /** AVCDecoderConfigurationRecord（WebCodecs decoderConfig.description，即 avcC 盒的载荷） */
  avcC: Uint8Array;
  /** 按时间顺序的采样；时长之和即媒体时长 */
  samples: Mp4Sample[];
}

// ---------------------------------------------------------- 字节写出小工具

function u16(v: number): Uint8Array {
  const out = new Uint8Array(2);
  out[0] = (v >>> 8) & 0xff;
  out[1] = v & 0xff;
  return out;
}

function u32(v: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (v >>> 24) & 0xff;
  out[1] = (v >>> 16) & 0xff;
  out[2] = (v >>> 8) & 0xff;
  out[3] = v & 0xff;
  return out;
}

/** 4 字符盒类型（'ftyp'、'avc1' …） */
function str4(s: string): Uint8Array {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4 && i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 任意长度的 ASCII 字节串（hdlr 的轨名等） */
function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 16.16 定点数（tkhd 的宽高、mvhd 的速率都用它） */
function fixed1616(v: number): Uint8Array {
  return u32(Math.round(v * 0x10000));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** 普通盒：4 字节大端长度（含头）+ 类型 + 载荷 */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([u32(body.length + 8), str4(type), body]);
}

/** fullbox：盒头之后多 1 字节 version + 3 字节 flags */
function fullbox(type: string, version: number, flags: number, ...payload: Uint8Array[]): Uint8Array {
  return box(
    type,
    new Uint8Array([version & 0xff, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]),
    ...payload,
  );
}

/** 视频轨必需的 unity 矩阵（a=1, d=1, w=16384），逐字面值写入 */
const UNITY_MATRIX = (): Uint8Array =>
  concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

// ---------------------------------------------------------------- 封装

/**
 * 把 H.264 采样封装为完整 MP4 文件。
 *
 * 结构：ftyp → moov(mvhd/trak(tkhd/mdia(mdhd/hdlr/minf(vmhd/dinf/stbl)))) → mdat。
 * 采样表的各项（stts/stss/stsc/stsz/stco）都由 samples 直接推出；stco 的块
 * 偏移取决于 moov 自身长度，所以 moov 构建两遍：第一遍拿到长度算出偏移，
 * 第二遍把真实偏移填进去（盒大小不随偏移值变化，两遍产物等长）。
 */
export function muxAvcMp4(opts: MuxAvcMp4Options): Uint8Array {
  const { width, height, avcC, samples } = opts;
  if (!Number.isInteger(width) || width <= 0 || width > 0xffff) throw new Error('MP4 宽度非法');
  if (!Number.isInteger(height) || height <= 0 || height > 0xffff) throw new Error('MP4 高度非法');
  if (samples.length === 0) throw new Error('MP4 没有采样');
  if (avcC.length === 0) throw new Error('MP4 缺少 avcC 配置');

  let mediaDuration = 0;
  for (const s of samples) {
    if (!Number.isInteger(s.durationMs) || s.durationMs < 1) throw new Error('MP4 采样时长非法');
    if (s.data.length === 0) throw new Error('MP4 采样为空');
    mediaDuration += s.durationMs;
  }
  if (mediaDuration > 0xffffffff) throw new Error('MP4 时长超出 32 位刻度');

  // --- ftyp：isom 主品牌，avc1 声明 H.264 轨
  const ftyp = box('ftyp', str4('isom'), u32(0x200), str4('isom'), str4('iso2'), str4('avc1'), str4('mp41'));

  // --- 采样表
  const sttsRuns: { count: number; delta: number }[] = [];
  for (const s of samples) {
    const last = sttsRuns[sttsRuns.length - 1];
    if (last && last.delta === s.durationMs) last.count += 1;
    else sttsRuns.push({ count: 1, delta: s.durationMs });
  }
  // 关键帧样本号（1 起）。全部都是关键帧时省略 stss —— 规范里缺省即「全部同步」
  const keySamples = samples.map((s, i) => (s.keyFrame ? i + 1 : 0)).filter((n) => n > 0);
  const stss =
    keySamples.length === samples.length
      ? null
      : fullbox('stss', 0, 0, u32(keySamples.length), concat(keySamples.map(u32)));

  const buildMoov = (chunkOffset: number): Uint8Array => {
    const stco = fullbox('stco', 0, 0, u32(1), u32(chunkOffset));
    const stbl = box(
      'stbl',
      fullbox('stsd', 0, 0, u32(1), avc1Entry(width, height, avcC)),
      fullbox('stts', 0, 0, u32(sttsRuns.length), concat(sttsRuns.flatMap((r) => [u32(r.count), u32(r.delta)]))),
      ...(stss ? [stss] : []),
      fullbox('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
      fullbox('stsz', 0, 0, u32(0), u32(samples.length), concat(samples.map((s) => u32(s.data.length)))),
      stco,
    );
    const mdia = box(
      'mdia',
      fullbox('mdhd', 0, 0, u32(0), u32(0), u32(1000), u32(mediaDuration), u16(0x55c4), u16(0)),
      fullbox('hdlr', 0, 0, u32(0), str4('vide'), u32(0), u32(0), u32(0), ascii('VideoHandler'), new Uint8Array(1)),
      box(
        'minf',
        fullbox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
        box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1))),
        stbl,
      ),
    );
    const trak = box(
      'trak',
      fullbox(
        'tkhd',
        0,
        3, // track_enabled | track_in_movie
        u32(0),
        u32(0),
        u32(1), // track_id
        u32(0), // reserved
        u32(mediaDuration), // 电影时间刻度也是 1000，直接用媒体时长
        u32(0),
        u32(0), // reserved[2]
        u16(0), // layer
        u16(0), // alternate_group
        u16(0), // 视频轨 volume 为 0
        u16(0), // reserved
        UNITY_MATRIX(),
        fixed1616(width),
        fixed1616(height),
      ),
      mdia,
    );
    const mvhd = fullbox(
      'mvhd',
      0,
      0,
      u32(0),
      u32(0),
      u32(1000),
      u32(mediaDuration),
      fixed1616(1), // rate
      u16(0x0100), // volume
      u16(0), // reserved
      u32(0),
      u32(0), // reserved[2]
      UNITY_MATRIX(),
      concat(Array.from({ length: 6 }, () => u32(0))), // pre_defined[6]
      u32(2), // next_track_id
    );
    return box('moov', mvhd, trak);
  };

  let moov = buildMoov(0);
  if (ftyp.length + moov.length > 0xffffffff - 8 || moov.length + 8 > 0xffffffff) {
    throw new Error('MP4 文件超出 32 位盒长度');
  }
  const chunkOffset = ftyp.length + moov.length + 8;
  if (chunkOffset > 0xffffffff) throw new Error('MP4 文件超出 32 位块偏移');
  moov = buildMoov(chunkOffset);

  const mdatPayload = concat(samples.map((s) => s.data));
  const out = new Uint8Array(ftyp.length + moov.length + 8 + mdatPayload.length);
  out.set(ftyp, 0);
  out.set(moov, ftyp.length);
  out.set(u32(mdatPayload.length + 8), ftyp.length + moov.length);
  out.set(str4('mdat'), ftyp.length + moov.length + 4);
  out.set(mdatPayload, ftyp.length + moov.length + 8);
  return out;
}

/** avc1 采样条目：VisualSampleEntry 头 + 内嵌 avcC（解码配置记录） */
function avc1Entry(width: number, height: number, avcC: Uint8Array): Uint8Array {
  return box(
    'avc1',
    new Uint8Array(6), // reserved
    u16(1), // data_reference_index
    u16(0), // pre_defined
    u16(0), // reserved
    new Uint8Array(12), // pre_defined[3]
    u16(width),
    u16(height),
    u32(0x00480000), // horizresolution：72 dpi
    u32(0x00480000), // vertresolution
    u32(0), // reserved
    u16(1), // frame_count
    new Uint8Array(32), // compressorname：首个字节是长度，全零即空
    u16(0x0018), // depth
    u16(0xffff), // pre_defined（-1）
    box('avcC', avcC),
  );
}
