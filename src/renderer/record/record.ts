import { buildGif, type StoredFrame } from '../../record/pipeline';
import { buildMp4 } from '../../record/mp4';
import { frameDurations } from '../../record/timeline';
import type { RecordBootPayload, RecordFramePayload, RecordStatusPayload } from '../../shared/types';

/**
 * 录制控制条（渲染进程）：收帧、去重、编码、显示状态。
 *
 * 帧在这里存成 RGBA，只有相邻两帧像素完全相同时才合并（静止画面不占内存）。
 * 编码在停止之后一次完成 —— 量化需要全片的颜色统计，不能边录边编。
 */

const timeEl = document.getElementById('time') as HTMLSpanElement;
const hintEl = document.getElementById('hint') as HTMLSpanElement;
const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel') as HTMLButtonElement;

let boot: RecordBootPayload | null = null;
let frames: StoredFrame[] = [];
let lastPixels: Uint8ClampedArray<ArrayBuffer> | null = null;
let storedBytes = 0;
/** 整段录制的尺寸：由第一张帧决定，之后尺寸不符的帧丢弃 */
let width = 0;
let height = 0;
let phase: RecordStatusPayload['phase'] = 'recording';
let stopRequested = false;

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** 逐字节比较：相同返回 true。帧尺寸固定，长度一致才比较。 */
function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function onFrame(payload: RecordFramePayload): void {
  // 主进程在 boot 回复之前就可能发出第一帧，所以这里不依赖 boot，尺寸由帧自己携带
  if (phase !== 'recording') return;
  if (width === 0) {
    width = payload.width;
    height = payload.height;
  }
  if (payload.width !== width || payload.height !== height) return;
  const pixels = new Uint8ClampedArray(payload.pixels.buffer, payload.pixels.byteOffset, payload.pixels.byteLength);
  // 与上一张存下的画面相同：什么都不做，上一张的显示时长会自然延长到下一张的时刻
  if (lastPixels && samePixels(lastPixels, pixels)) return;
  // 复制一份：IPC 传来的缓冲可能与其它数据共享底层 ArrayBuffer
  const owned = new Uint8ClampedArray(pixels);
  frames.push({ pixels: owned, at: payload.at });
  lastPixels = owned;
  storedBytes += owned.byteLength;
  if (boot && storedBytes >= boot.maxBytes && !stopRequested) {
    stopRequested = true;
    hintEl.textContent = '已达到内存上限，正在停止';
    void window.snip.record.action({ kind: 'stop' }).catch(() => {});
  }
}

function onStatus(status: RecordStatusPayload): void {
  phase = status.phase;
  timeEl.textContent = fmt(status.elapsedMs);
  if (status.phase === 'recording') hintEl.textContent = '录制中';
  if (status.phase === 'paused') hintEl.textContent = '已暂停';
  if (status.phase === 'stopping') hintEl.textContent = '正在编码…';
  pauseBtn.textContent = status.phase === 'paused' ? '继续' : '暂停';
  pauseBtn.disabled = status.phase === 'stopping';
  stopBtn.disabled = status.phase === 'stopping';
}

/** 把 RGBA 帧转成 PNG（OffscreenCanvas，渲染进程内完成）。 */
async function toPng(frame: StoredFrame, width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.putImageData(new ImageData(frame.pixels, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

async function encode(endAt: number): Promise<void> {
  try {
    if (!boot) throw new Error('控制条尚未就绪');
    const format = boot.format;
    if (frames.length === 0) throw new Error('没有录到任何画面');
    if (format === 'gif') {
      const gif = buildGif(width, height, frames, endAt);
      await window.snip.record.done({ ok: true, format, width, height, frames: frames.length, durationMs: endAt, gif });
      return;
    }
    if (format === 'mp4') {
      // WebCodecs H.264 编码：环境不支持时编码器会抛错，走统一的失败回传
      const mp4 = await buildMp4(width, height, frames, endAt);
      await window.snip.record.done({ ok: true, format, width, height, frames: frames.length, durationMs: endAt, mp4 });
      return;
    }
    const pngs: Uint8Array[] = [];
    for (const f of frames) pngs.push(await toPng(f, width, height));
    const last = frames[frames.length - 1].at;
    const delays = frameDurations([...frames.map((f) => f.at), Math.max(endAt, last + 1)], boot.fps).slice(
      0,
      frames.length,
    );
    await window.snip.record.done({
      ok: true,
      format,
      width,
      height,
      frames: frames.length,
      durationMs: endAt,
      pngs,
      delays,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await window.snip.record.done({ ok: false, error }).catch(() => {});
  } finally {
    frames = [];
    lastPixels = null;
  }
}

pauseBtn.addEventListener('click', () => {
  void window.snip.record.action({ kind: phase === 'paused' ? 'resume' : 'pause' }).catch(() => {});
});
stopBtn.addEventListener('click', () => {
  void window.snip.record.action({ kind: 'stop' }).catch(() => {});
});
cancelBtn.addEventListener('click', () => {
  void window.snip.record.action({ kind: 'cancel' }).catch(() => {});
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    void window.snip.record.action({ kind: 'cancel' }).catch(() => {});
  }
});

window.snip.record.frame(onFrame);
window.snip.record.status(onStatus);
window.snip.record.encode((payload) => void encode(payload.endAt));

void window.snip.record.boot().then((payload) => {
  boot = payload;
  if (!payload) hintEl.textContent = '录制未启动';
});
