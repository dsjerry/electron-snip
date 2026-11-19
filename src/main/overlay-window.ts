import { BrowserWindow } from 'electron';
import path from 'node:path';
import type { WebContents } from 'electron';
import type { DisplayShot } from '../shared/types';
import { forwardRendererLogs, log } from './log';

/**
 * 只在窗口**创建时**接线一次 —— 窗口会被复用，每次截图都挂一遍
 * `before-input-event` / `closed` 会堆出重复监听器。
 */
export interface OverlayHooks {
  /** 返回 true 表示由会话处理，主进程才拦截这次按键；false 则放行给渲染进程（如文字框换行） */
  onKey(webContents: WebContents, kind: 'escape' | 'enter'): boolean;
  onClosed(contentsId: number): void;
}

export interface OverlayPoolOptions {
  preloadPath: string;
  rendererDir: string;
}

const OVERLAY_LEVEL = 'screen-saver' as const;

/**
 * 每块显示器一个遮罩窗口（displayId -> 窗口）。复用是它的全部意义：
 * 省掉每次重建窗口 + 重新加载页面。
 */
export class OverlayPool {
  private readonly cache = new Map<number, BrowserWindow>();

  constructor(
    private readonly opts: OverlayPoolOptions,
    private readonly hooks: OverlayHooks,
  ) {}

  /** 取一块屏的遮罩窗口：有缓存就复用（重设 bounds + reload），没有才新建。 */
  acquire(shot: DisplayShot): { win: BrowserWindow; load: Promise<void> } {
    const b = shot.bounds;
    const cached = this.cache.get(shot.displayId);
    if (cached && !cached.isDestroyed()) {
      // 显示器位置/分辨率可能变过，落一次 bounds
      cached.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
      cached.reload();
      return { win: cached, load: Promise.resolve() };
    }
    const win = this.create(shot);
    this.cache.set(shot.displayId, win);
    return { win, load: win.loadFile(path.join(this.opts.rendererDir, 'overlay.html')) };
  }

  /** 拔掉显示器 / 窗口已销毁的缓存项。 */
  prune(liveDisplayIds: Set<number>): void {
    for (const [id, win] of this.cache) {
      if (win.isDestroyed()) {
        this.cache.delete(id);
        continue;
      }
      if (!liveDisplayIds.has(id)) {
        this.cache.delete(id);
        win.destroy();
      }
    }
  }

  destroyAll(): void {
    for (const win of this.cache.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.cache.clear();
  }

  private create(shot: DisplayShot): BrowserWindow {
    const b = shot.bounds;

    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      // thickFrame:false —— 否则无边框窗口会吃到 Aero Snap / 隐形边框，bounds 会偏几像素
      thickFrame: false,
      hasShadow: false,
      skipTaskbar: true,
      // 不用 transparent:true（Windows 上不可靠）；画布自己铺截图做背景
      backgroundColor: '#000000',
      fullscreenable: false,
      // macOS：AppKit 会在窗口首次上屏时把 bounds 约束进工作区（菜单栏以下），
      // 遮罩被整体下移一条菜单栏的高度 —— 真实菜单栏从遮罩顶上露出来，和抓屏
      // 图里的菜单栏叠成两条，且顶部区域选不到。实测（CGWindowList + 探针）只有
      // 这个开关能跳过该约束；show 后再 setBounds / type:'panel' 都无效。遮罩
      // 恰好等于屏幕大小，"larger than screen" 的其余语义用不上，Windows 忽略它。
      enableLargerThanScreen: true,
      focusable: true,
      webPreferences: {
        preload: this.opts.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // 构造函数的 alwaysOnTop 只接受布尔，层级必须单独设置。
    // status 及以下在任务栏之下，popup-menu 及以上在任务栏之上 —— 遮罩必须盖住任务栏。
    win.setAlwaysOnTop(true, OVERLAY_LEVEL);
    // 构造函数传入的宽高会被 WM_GETMINMAXINFO 钳到**工作区**（任务栏以上）
    // —— 首次创建的遮罩会比显示器矮一条任务栏，真实任务栏从遮罩下面露出，
    // 截图里出现两条任务栏。与 pin-window 同解：创建后紧跟 setBounds 强制落位
    //（缓存窗口复用走的 setBounds 不受钳制，所以只有冷启动看得到）。
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    // 遮罩自身不能被别的截图工具截进去（Win10 build 19044 支持 WDA_EXCLUDEFROMCAPTURE）
    win.setContentProtection(true);
    forwardRendererLogs(win, `overlay:${shot.displayId}`);
    // 渲染进程崩溃 / 无响应时遮罩会「卡死在屏幕上」，没有这行日志就只能瞎猜
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error(`[overlay:${shot.displayId}] 渲染进程退出 reason=${details.reason} exitCode=${details.exitCode}`);
    });
    win.on('unresponsive', () => {
      log.warn(`[overlay:${shot.displayId}] 窗口无响应`);
    });

    const contentsId = win.webContents.id;

    // Escape / Enter 在主进程处理：preventDefault 之后渲染进程收不到，
    // 因此不会和渲染进程的 keydown 重复触发；渲染进程 JS 挂了也照样有效。
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const kind =
        input.key === 'Escape' ? 'escape' : input.key === 'Enter' || input.key === 'NumpadEnter' ? 'enter' : null;
      if (kind && this.hooks.onKey(win.webContents, kind)) event.preventDefault();
    });

    win.on('closed', () => {
      for (const [id, w] of this.cache) {
        if (w === win) this.cache.delete(id);
      }
      this.hooks.onClosed(contentsId);
    });

    return win;
  }
}
