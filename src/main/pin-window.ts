import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { Rect } from '../shared/types';
import { forwardRendererLogs, log } from './log';

export interface PinWindowOptions {
  preloadPath: string;
  rendererDir: string;
}

/**
 * 钉图窗口：无边框、**透明**、置顶、不可 resize（否则会被 Aero Snap 吸走）。
 *
 * `bounds` = 图像 + **四边阴影留白**（由 `computePinLayout` 算好，随 `pin:boot`
 * 下发），这里只负责原样落地。
 *
 * 必须 `transparent`：外阴影是画在窗口自己那圈留白里的（CSS `box-shadow`），
 * 窗口不透明的话阴影会被自己的底色盖住。相应地 `hasShadow: false` ——
 * `thickFrame: false` 下 Windows 本来也不给系统阴影，别指望那一层。
 */
export class PinRegistry {
  /** 全部存活的贴图窗口 */
  private readonly pins = new Set<BrowserWindow>();
  /** 处于鼠标点击穿透状态的贴图窗口（isIgnoreMouseEvents 无查询接口） */
  private readonly mouseIgnored = new WeakSet<BrowserWindow>();

  constructor(private readonly opts: PinWindowOptions) {}

  create(bounds: Rect): BrowserWindow {
    const want = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(120, Math.round(bounds.width)),
      height: Math.max(90, Math.round(bounds.height)),
    };
    const win = new BrowserWindow({
      ...want,
      frame: false,
      show: false,
      resizable: false,
      thickFrame: false,
      hasShadow: false,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.opts.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // 构造函数传入的宽高会被 Windows 的 WM_GETMINMAXINFO 先钳一次
    // （跨屏窗口尤其明显，会收到「光标所在监视器」的尺寸）。
    // Electron 随后把 min/max 锁到我们请求的值，所以紧跟一次 setBounds 就能落到位。
    win.setBounds(want);
    log.info(
      `[pin-window] 请求 ${want.width}x${want.height}@${want.x},${want.y}` +
        ` -> 实际 ${JSON.stringify(win.getBounds())}`,
    );

    // 钉图在普通应用之上，但仍在任务栏之下（floating < screen-saver）
    win.setAlwaysOnTop(true, 'floating');
    forwardRendererLogs(win, 'pin');
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error(`[pin-window] 渲染进程退出 reason=${details.reason} exitCode=${details.exitCode}`);
    });
    win.on('unresponsive', () => log.warn('[pin-window] 窗口无响应'));
    win.on('closed', () => {
      log.info('[pin-window] closed');
      this.pins.delete(win);
    });
    this.pins.add(win);
    return win;
  }

  load(win: BrowserWindow): Promise<void> {
    return win.loadFile(path.join(this.opts.rendererDir, 'pin.html'));
  }

  closeAll(): void {
    for (const win of this.pins) {
      if (!win.isDestroyed()) win.close();
    }
    this.pins.clear();
  }

  /** Ctrl+T：切换该贴图的鼠标点击穿透，返回切换后的状态。 */
  toggleMouseIgnore(win: BrowserWindow): boolean {
    const next = !this.mouseIgnored.has(win);
    if (next) this.mouseIgnored.add(win);
    else this.mouseIgnored.delete(win);
    win.setIgnoreMouseEvents(next, { forward: next });
    return next;
  }

  /** 按钮 / 滚轮缩放：窗口尺寸 × factor，光标下的点保持不动。 */
  zoom(win: BrowserWindow, factor: number): void {
    const b = win.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const f = Math.min(4, Math.max(0.25, factor));
    win.setBounds({
      x: Math.round(cursor.x - (cursor.x - b.x) * f),
      y: Math.round(cursor.y - (cursor.y - b.y) * f),
      width: Math.round(b.width * f),
      height: Math.round(b.height * f),
    });
  }

  opacity(win: BrowserWindow, delta: number): void {
    win.setOpacity(Math.min(1, Math.max(0.15, win.getOpacity() + delta)));
  }
}
