import { BrowserWindow, screen } from 'electron';
import type { Display, WebContents } from 'electron';
import path from 'node:path';
import { captureDisplays } from '../main/capture';
import { forwardRendererLogs, log } from '../main/log';
import { CH } from '../shared/channels';
import { cropShot } from '../shared/crop';
import type {
  DisplayShot,
  RecordActionPayload,
  RecordBootPayload,
  RecordDonePayload,
  RecordFormat,
  RecordFramePayload,
  RecordStatusPayload,
  Rect,
} from '../shared/types';
import { placeBar } from '../shared/placement';
import { elapsedMs } from './timeline';

/**
 * 录制（子路径 electron-snip/record）：单屏录制选区，输出 GIF / MP4 / PNG 序列。
 *
 * 分工：主进程只管节奏与时间 —— 固定间隔抓屏、按选区裁剪、扣除暂停时长后打上时刻，
 * 然后把帧交给控制条渲染进程。去重、量化与编码都在渲染进程做，避免卡住主进程的事件循环。
 * 结束后渲染进程把结果回传，复制 / 保存 / 写盘由宿主通过 `onFinish` 决定。
 *
 * 只支持单屏选区：控制条要贴着选区摆，跨屏时混合 DPI 下帧尺寸会随之变化。
 */

export interface RecordConfig {
  /** 包的 preload 绝对路径（控制条用它访问 window.snip） */
  preloadPath: string;
  /** 包内渲染资源目录（含 record.html） */
  rendererDir: string;
}

export interface RecordOptions {
  /** 选区所在屏的截图（第一帧直接用它，不必等待抓屏） */
  shot: DisplayShot;
  /** 选区（虚拟屏 DIP） */
  region: Rect;
  format: RecordFormat;
  config: RecordConfig;
  /** 帧率，默认 10 */
  fps?: number;
  /** 单次录制的最长时长（毫秒），默认 5 分钟 */
  maxDurationMs?: number;
  /** 帧内存预算（字节），默认 384MB */
  maxBytes?: number;
}

export interface RecordFinish {
  format: RecordFormat;
  width: number;
  height: number;
  frames: number;
  durationMs: number;
  /** format 为 gif 时：完整 GIF 字节 */
  gif?: Uint8Array;
  /** format 为 mp4 时：完整 MP4 文件字节（H.264，faststart） */
  mp4?: Uint8Array;
  /** format 为 png-sequence 时：按时间顺序的 PNG 字节 */
  pngs?: Uint8Array[];
  /** format 为 png-sequence 时：每张 PNG 的显示时长（毫秒） */
  delays?: number[];
}

export interface RecordHooks {
  /** 编码完成：宿主决定复制、保存或丢弃 */
  onFinish(result: RecordFinish): void | Promise<void>;
  /** 录制被取消、控制条被关闭或编码失败 */
  onCancel(reason: string): void;
}

const DEFAULT_FPS = 10;
const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_BYTES = 384 * 1024 * 1024;
const STATUS_INTERVAL_MS = 250;
const BAR_W = 440;
const BAR_H = 96;

interface Session {
  bar: BrowserWindow;
  display: Display;
  region: Rect;
  format: RecordFormat;
  fps: number;
  maxDurationMs: number;
  maxBytes: number;
  hooks: RecordHooks;
  phase: RecordStatusPayload['phase'];
  startedAt: number;
  pausedAt: number | null;
  pausedTotal: number;
  /** 首帧尺寸即整段录制的尺寸；尺寸不一致的帧直接丢弃 */
  width: number;
  height: number;
  firstShot: DisplayShot | null;
  frames: number;
  busy: boolean;
  frameTimer: NodeJS.Timeout | null;
  statusTimer: NodeJS.Timeout | null;
  ready: boolean;
}

let session: Session | null = null;

export function isRecording(): boolean {
  return session !== null;
}

/**
 * 开始录制。返回 false 表示已在录制或选区所在屏找不到。
 * `session` 在任何异步操作之前同步赋值，因此随时可以被 `cancelRecording()` 收掉。
 */
export function startRecording(opts: RecordOptions, hooks: RecordHooks): boolean {
  if (session) return false;
  const display = screen.getAllDisplays().find((d) => d.id === opts.shot.displayId);
  if (!display) return false;

  const bar = new BrowserWindow({
    ...placeBar(opts.region, display.bounds, { width: BAR_W, height: BAR_H }),
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    thickFrame: false,
    hasShadow: false,
    skipTaskbar: true,
    // transparent 窗口不要设 backgroundColor，否则会垫一层不透明合成面
    transparent: true,
    fullscreenable: false,
    webPreferences: {
      preload: opts.config.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  // 控制条绝不能出现在自己的录像里
  bar.setContentProtection(true);
  forwardRendererLogs(bar, 'record');

  session = {
    bar,
    display,
    region: opts.region,
    format: opts.format,
    fps: opts.fps ?? DEFAULT_FPS,
    maxDurationMs: opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
    hooks,
    phase: 'recording',
    startedAt: performance.now(),
    pausedAt: null,
    pausedTotal: 0,
    width: 0,
    height: 0,
    firstShot: opts.shot,
    frames: 0,
    busy: false,
    frameTimer: null,
    statusTimer: null,
    ready: false,
  };

  bar.on('closed', () => {
    // 控制条被系统关闭（如 Alt+F4）：按取消收场
    if (session?.bar === bar) endSession(session, 'record-closed', null);
  });

  const self = session;
  void bar.loadFile(path.join(opts.config.rendererDir, 'record.html')).catch((err: unknown) => {
    // 窗口被提前销毁（如取消）时加载也会以 ERR_FAILED 拒绝，此时会话已经收场，不要重复处理
    if (bar.isDestroyed()) return;
    log.error('[record] 控制条加载失败', err);
    endSession(self, 'record-load-failed', null);
  });
  bar.once('ready-to-show', () => bar.showInactive());
  log.info(
    `[record] 开始录制 display=${opts.shot.displayId} region=${Math.round(opts.region.width)}x${Math.round(opts.region.height)}`,
  );
  return true;
}

/** 控制条调用：取得启动参数。第一次调用即开始抓帧。 */
export function bootRecording(sender: WebContents): RecordBootPayload | null {
  const s = session;
  if (!s || s.bar.webContents.id !== sender.id) return null;
  if (!s.ready) {
    s.ready = true;
    s.statusTimer = setInterval(() => tick(s), STATUS_INTERVAL_MS);
    scheduleFrame(s);
  }
  return {
    format: s.format,
    width: s.width || Math.round(s.region.width),
    height: s.height || Math.round(s.region.height),
    fps: s.fps,
    maxBytes: s.maxBytes,
  };
}

function scheduleFrame(s: Session): void {
  if (s.frameTimer) return;
  s.frameTimer = setInterval(() => void grabFrame(s), 1000 / s.fps);
  void grabFrame(s);
}

function stopFrameTimer(s: Session): void {
  if (s.frameTimer) clearInterval(s.frameTimer);
  s.frameTimer = null;
}

function now(s: Session): number {
  return elapsedMs(performance.now(), s.startedAt, s.pausedTotal, s.pausedAt);
}

async function grabFrame(s: Session): Promise<void> {
  if (session !== s || s.phase !== 'recording' || s.busy || s.bar.isDestroyed()) return;
  s.busy = true;
  try {
    const at = now(s);
    let shot: DisplayShot | null = s.firstShot;
    s.firstShot = null;
    if (!shot) {
      const [fresh] = await captureDisplays([s.display], screen.getAllDisplays(), true);
      shot = fresh;
    }
    if (session !== s || s.phase !== 'recording' || s.bar.isDestroyed()) return;
    const frame = cropShot(shot, s.region);
    if (s.width === 0) {
      s.width = frame.width;
      s.height = frame.height;
    }
    // 尺寸变化（显示器缩放等）的帧不能拼进同一个 GIF，直接丢弃
    if (frame.width !== s.width || frame.height !== s.height) return;
    const payload: RecordFramePayload = { pixels: frame.pixels, width: frame.width, height: frame.height, at };
    s.frames++;
    s.bar.webContents.send(CH.recordFrame, payload);
  } catch (err) {
    log.error('[record] 抓帧失败', err);
  } finally {
    s.busy = false;
  }
}

/** 心跳：推送状态，并在录制时间（扣除暂停）超过上限时停止。 */
function tick(s: Session): void {
  pushStatus(s);
  if (s.phase === 'recording' && now(s) >= s.maxDurationMs) void stopRecording('max-duration');
}

function pushStatus(s: Session): void {
  if (session !== s || s.bar.isDestroyed()) return;
  const status: RecordStatusPayload = { phase: s.phase, elapsedMs: now(s), frames: s.frames };
  s.bar.webContents.send(CH.recordStatus, status);
}

/** 控制条的动作入口：校验来源，再分发。 */
export function handleRecordAction(sender: WebContents, payload: RecordActionPayload): void {
  const s = session;
  if (!s || s.bar.webContents.id !== sender.id) return;
  switch (payload.kind) {
    case 'pause':
      if (s.phase !== 'recording') return;
      s.phase = 'paused';
      s.pausedAt = performance.now();
      stopFrameTimer(s);
      pushStatus(s);
      return;
    case 'resume':
      if (s.phase !== 'paused') return;
      if (s.pausedAt !== null) s.pausedTotal += performance.now() - s.pausedAt;
      s.pausedAt = null;
      s.phase = 'recording';
      scheduleFrame(s);
      pushStatus(s);
      return;
    case 'stop':
      void stopRecording('user');
      return;
    case 'cancel':
      endSession(s, 'record-cancel', null);
      return;
  }
}

/** 停止抓帧并让控制条编码；`reason` 只用于日志。 */
async function stopRecording(reason: string): Promise<void> {
  const s = session;
  if (!s || s.phase === 'stopping') return;
  log.info(`[record] 停止录制（${reason}）frames=${s.frames}`);
  if (s.pausedAt !== null) {
    s.pausedTotal += performance.now() - s.pausedAt;
    s.pausedAt = null;
  }
  s.phase = 'stopping';
  stopFrameTimer(s);
  pushStatus(s);
  if (s.frames === 0 || s.bar.isDestroyed()) {
    endSession(s, 'record-empty', null);
    return;
  }
  s.bar.webContents.send(CH.recordEncode, { endAt: now(s) });
}

/**
 * 控制条编码完成后的回传。失败时收场并报告原因，不留半成品。
 */
export function finishRecording(sender: WebContents, payload: RecordDonePayload): void {
  const s = session;
  if (!s || s.bar.webContents.id !== sender.id) return;
  // 推迟收场：销毁控制条必须在回复 invoke 之后，否则回复会落在已销毁的 webContents 上
  if (!payload.ok) {
    log.error('[record] 编码失败', payload.error);
    setTimeout(() => endSession(s, 'record-encode-failed', null), 0);
    return;
  }
  const result: RecordFinish = {
    format: payload.format,
    width: payload.width,
    height: payload.height,
    frames: payload.frames,
    durationMs: payload.durationMs,
    gif: payload.gif,
    mp4: payload.mp4,
    pngs: payload.pngs,
    delays: payload.delays,
  };
  setTimeout(() => endSession(s, null, result), 0);
}

/** 外部取消（如截图会话被新的快捷键重启）。 */
export function cancelRecording(): void {
  if (session) endSession(session, 'record-cancel', null);
}

/**
 * 统一收场：停止定时器、销毁控制条。`cancelReason` 非空表示未产出结果；
 * `result` 非空表示正常完成。
 *
 * 必须传入**发起收场的那一个会话**：异步回调（加载失败、延时收场）可能在下一次
 * 录制已经开始之后才到达，若按「当前会话」收场，会误杀新的录制。
 */
function endSession(target: Session, cancelReason: string | null, result: RecordFinish | null): void {
  if (session !== target) return;
  session = null;
  stopFrameTimer(target);
  if (target.statusTimer) clearInterval(target.statusTimer);
  if (!target.bar.isDestroyed()) target.bar.destroy();
  if (result) {
    void Promise.resolve(target.hooks.onFinish(result)).catch((err: unknown) =>
      log.error('[record] onFinish 失败', err),
    );
  } else if (cancelReason) {
    target.hooks.onCancel(cancelReason);
  }
}
