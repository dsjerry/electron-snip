import type { StoredFrame } from './pipeline';
import { muxAvcMp4, type Mp4Sample } from './mp4-muxer';

/**
 * MP4 编码：WebCodecs H.264（VideoEncoder）+ 内置封装器。
 *
 * 与 buildGif 同层的纯编码函数，但不依赖 DOM —— VideoEncoder / VideoFrame 是
 * WebCodecs 接口，控制条渲染进程直接可用。必须在渲染进程跑：Node 主进程没有
 * WebCodecs，硬塞进去会在调用时报错。
 *
 * 帧仍是「RGBA + 毫秒时刻」：编码时逐帧转成 VideoFrame，时间戳按毫秒 ×1000
 * 送进编码器；采样时长取相邻帧间隔（与 GIF 同口径，静止帧已被控制条去重，
 * 时长自然延长）。H.264 宽高必须为偶数（色度 2×2 子采样），奇数选区走
 * OffscreenCanvas 补一列 / 一行黑边再编码，成品内容不变。
 */

export interface Mp4Options {
  /** 目标码率（bps）。缺省按分辨率 × 平均帧率估计，屏幕内容够用 */
  bitrate?: number;
  /** 强制关键帧的最小间隔（毫秒），默认 2000。关键帧多则 seek 快、体积大 */
  keyFrameIntervalMs?: number;
}

/**
 * H.264 等级：宏块行 ×16 为高，每秒宏块数不得超过等级上限，否则编码器拒收。
 * 只列出录屏会落在的档位（3.0 起步：常见选区都在这一档，兼容性也最好）。
 */
const LEVEL_MBPS: { idc: number; maxMbPerSec: number }[] = [
  { idc: 30, maxMbPerSec: 40500 },
  { idc: 31, maxMbPerSec: 108000 },
  { idc: 32, maxMbPerSec: 216000 },
  { idc: 40, maxMbPerSec: 245760 },
  { idc: 42, maxMbPerSec: 5222400 },
  { idc: 50, maxMbPerSec: 5898240 },
  { idc: 52, maxMbPerSec: 5898240 },
];

/**
 * 选出能容纳「宽 × 高 × 帧率」的编码档位，按 profile 从兼容到高效依次试探：
 * Baseline（不含 B 帧，播放兼容性最好）→ Main → High。全部不可用即报错。
 */
async function pickCodec(width: number, height: number, fps: number, bitrate: number): Promise<string> {
  const mbPerSec = Math.ceil(width / 16) * Math.ceil(height / 16) * fps;
  const level = LEVEL_MBPS.find((l) => mbPerSec <= l.maxMbPerSec)?.idc ?? 52;
  const hex = level.toString(16).toUpperCase().padStart(2, '0');
  const profiles = ['4200', '4d00', '6400']; // Baseline / Main / High，constraint flags 0
  for (const p of profiles) {
    const codec = `avc1.${p}${hex}`;
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      avc: { format: 'avc' },
    });
    if (support.supported) return codec;
  }
  throw new Error('当前环境没有可用的 H.264 编码器，无法导出 MP4');
}

/** 把 RGBA 帧序列编码成完整 MP4 文件字节。 */
export async function buildMp4(
  width: number,
  height: number,
  frames: StoredFrame[],
  endAt: number,
  opts: Mp4Options = {},
): Promise<Uint8Array> {
  if (width <= 0 || height <= 0) throw new Error('MP4 尺寸非法');
  if (frames.length === 0) throw new Error('没有可导出的帧');
  if (frames[0].pixels.length !== width * height * 4) throw new Error('帧尺寸与声明不符');

  // H.264 要求偶数宽高：奇数选区补黑边（≤1px），编码尺寸与画面尺寸就分开了。
  // 档位与码率都要按编码尺寸算 —— 编码器拒绝奇数宽高，65×47 探针会直接失败
  const encWidth = width + (width % 2);
  const encHeight = height + (height % 2);
  const padded = encWidth !== width || encHeight !== height;

  // 平均帧率（帧数 ÷ 实际时长）参与码率估计；时间上钳到常见区间，避免极端值。
  // endAt 同为小数毫秒，一并取整（采样时长按整毫秒算）
  const end = Math.max(Math.round(endAt), Math.round(frames[frames.length - 1].at) + 1);
  const fps = Math.min(30, Math.max(1, Math.round((frames.length / end) * 1000)));
  const bitrate =
    opts.bitrate ?? Math.min(20_000_000, Math.max(1_000_000, Math.round(encWidth * encHeight * fps * 0.15)));
  const keyFrameIntervalMs = opts.keyFrameIntervalMs ?? 2000;
  const codec = await pickCodec(encWidth, encHeight, fps, bitrate);

  let padCanvas: OffscreenCanvas | null = null;
  let padCtx: OffscreenCanvasRenderingContext2D | null = null;
  if (padded) {
    padCanvas = new OffscreenCanvas(encWidth, encHeight);
    padCtx = padCanvas.getContext('2d');
  }

  let encoder: VideoEncoder | null = null;
  try {
    const samples: Mp4Sample[] = [];
    let avcC: Uint8Array | null = null;
    let encodeError: unknown = null;
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        // decoderConfig 只在首个输出携带，description 即 avcC 载荷（avc 格式约定）
        const description = meta?.decoderConfig?.description;
        if (description && !avcC) {
          // 可能是裸 ArrayBuffer，也可能是带偏移的视图，两种都得转成字节
          avcC =
            'byteOffset' in description
              ? new Uint8Array(description.buffer as ArrayBuffer, description.byteOffset, description.byteLength)
              : new Uint8Array(description as ArrayBuffer);
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({ data, durationMs: 0, keyFrame: chunk.type === 'key' });
      },
      error: (err) => {
        // 回调在事件循环里异步到达：记下来让主流程感知，编码器自己不再产出
        encodeError = encodeError ?? err;
      },
    });
    encoder.configure({
      codec,
      width: encWidth,
      height: encHeight,
      bitrate,
      framerate: fps,
      avc: { format: 'avc' },
    });

    let lastKeyAt = -Infinity;
    const durations: number[] = [];
    for (let i = 0; i < frames.length; i++) {
      if (encodeError) throw encodeError;
      const frame = frames[i];
      // 采样时长 = 到下一帧的间隔；最后一帧到 endAt（与 GIF 的口径一致）。
      // 时刻是小数毫秒（performance.now 基准），取整到毫秒 —— MP4 采样时长是整数
      const nextAt = i + 1 < frames.length ? frames[i + 1].at : end;
      const durationMs = Math.max(1, Math.round(nextAt - frame.at));
      durations.push(durationMs);
      // TS 的 VideoFrameBufferInit 要求 format 与编码尺寸：画布路径用不到但字段必须齐
      const init: VideoFrameBufferInit = {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: Math.round(frame.at * 1000), // VideoFrame 用微秒
        duration: durationMs * 1000,
      };
      let vf: VideoFrame;
      if (padded) {
        if (!padCanvas || !padCtx) throw new Error('无法创建画布上下文');
        padCanvas.width = encWidth; // 清空画布，上一帧的残留像素不能进本帧
        padCtx.fillStyle = '#000';
        padCtx.fillRect(0, 0, encWidth, encHeight);
        padCtx.putImageData(new ImageData(frame.pixels, width, height), 0, 0);
        vf = new VideoFrame(padCanvas, { timestamp: init.timestamp, duration: init.duration });
      } else {
        // 直接收视图而非底层 buffer：字节数组的偏移 / 长度由构造器自己处理
        vf = new VideoFrame(frame.pixels, init);
      }
      // 静止画面压一个长 GOP 就够：按时间而不是帧数请求关键帧
      const keyFrame = frame.at - lastKeyAt >= keyFrameIntervalMs;
      if (keyFrame) lastKeyAt = frame.at;
      encoder.encode(vf, { keyFrame });
      vf.close();
      // 编码提交是 CPU 活（RGBA → YUV 转换在主线程），定期让出事件循环，
      // 控制条的「正在编码…」提示与计时才不会冻住
      if (i % 16 === 15) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    encoder.close();
    encoder = null;
    if (!avcC) throw new Error('编码器未返回 avcC 配置，无法封装 MP4');
    // 输出按提交顺序到达（Baseline/Main 无 B 帧，解码序即显示序），逐帧回填时长
    if (samples.length !== frames.length) throw new Error('编码器输出的采样数与帧数不符');
    samples.forEach((s, i) => (s.durationMs = durations[i]));
    return muxAvcMp4({ width: encWidth, height: encHeight, avcC, samples });
  } finally {
    // 出错也要归还编码器资源；close 对已 errored / closed 的实例是幂等空操作
    if (encoder && encoder.state !== 'closed') encoder.close();
  }
}
