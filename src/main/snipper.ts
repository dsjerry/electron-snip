import { BrowserWindow, nativeImage, screen } from 'electron';
import type { IpcMain, WebContents } from 'electron';
import { CH } from '../shared/channels';
import { bestRegionOnDisplay, displayAt, resolveOutScale, unionBounds } from '../shared/geometry';
import { clampRect, hitBorder, hitHandle, moveRect, pointInRect, resizeRect } from '../shared/selection';
import type { HandleId } from '../shared/selection';
import { computePinLayout } from '../shared/pin-layout';
import type { PinPadding } from '../shared/pin-layout';
import { mapShape } from '../shared/shape-transform';
import type {
  DisplayShot,
  OverlayComposePayload,
  OverlayInitPayload,
  OverlayInput,
  OverlayRemoteDraftPayload,
  OverlayRemoteShapesPayload,
  OverlaySelectionPayload,
  PinActionResult,
  PinAction,
  PinBootPayload,
  Point,
  Rect,
  Shape,
  SnipPhase,
  ToolId,
} from '../shared/types';
import type { SnipActionContext, SnipAction, SnipOptions, Snipper } from '../types';
import { captureDisplays, displayAtCursor } from './capture';
import { ensureScreenCaptureAccess } from './permission';
import { listWindowRects } from './windows';
import { OverlayPool } from './overlay-window';
import type { OverlayHooks } from './overlay-window';
import { PinRegistry } from './pin-window';
import { copyPng, copyText, defaultSnipName, savePng } from './export';
import { log, setLogger } from './log';
import { installIpc } from './ipc';
import type { SnipHandlers } from './ipc';

/**
 * 当前这次按下在做什么。真相源始终是 `screen.getCursorScreenPoint()`，
 * 这里只存「按下瞬间的基准」，每帧用光标增量重算。
 */
type DragMode =
  /** 重新框选；prev 是误点时要还原的旧选区 */
  | { kind: 'new'; anchor: Point; prev: Rect | null }
  /** 窗口捕获待定：原地点击 = 采纳整窗；拖动过阈值 = 转为普通框选 */
  | { kind: 'window'; anchor: Point }
  /** 整体移动 */
  | { kind: 'move'; origin: Rect; start: Point }
  /** 拖手柄调整 */
  | { kind: 'resize'; origin: Rect; handle: HandleId; start: Point };

interface Session {
  shots: DisplayShot[];
  virtualBounds: Rect;
  overlays: BrowserWindow[];
  /** webContents.id -> 它对应那块屏的截图 */
  shotByContents: Map<number, DisplayShot>;
  /** webContents.id -> overlay window */
  byContents: Map<number, BrowserWindow>;
  ready: Set<number>;
  shown: boolean;
  mode: DragMode | null;
  selection: Rect | null;
  poll: NodeJS.Timeout | null;
  phase: SnipPhase;
  pendingPin: BrowserWindow | null;
  /** 钉图窗口布局（图像 + 阴影留白），确认时算好，boot 时原样回给渲染进程 */
  pinLayout: { bounds: Rect; padding: PinPadding } | null;
  /** 当前标注工具（选区下方工具条选的），广播给所有遮罩 */
  activeTool: ToolId;
  /** 正在打字的遮罩：这些窗口的 Enter / Esc 交给渲染进程 */
  editText: Set<number>;
  /** webContents.id -> 本屏 DIP 坐标的标注，确认时统一换算成图像像素 */
  shapesByContents: Map<number, Shape[]>;
  /** webContents.id -> 正被拖动 / 缩放的标注下标（null = 无）；广播给其余屏时滤掉 */
  inFlightByContents: Map<number, number | null>;
  /** 光标下的应用窗口（虚拟屏 DIP）；仅 selecting 且尚无选区时非空 */
  hoverRect: Rect | null;
  hoverPoll: NodeJS.Timeout | null;
  hoverBusy: boolean;
  hoverErrorLogged: boolean;
  /** 光标下按 z 序排列的全部窗口（Tab 轮换用） */
  hoverCandidates: Rect[];
  hoverIndex: number;
  /** 会话创建时刻，用于「触发 → 首窗 ready」的总耗时打点 */
  startedAt: number;
  /** 来源应用：会话开始时的前台窗口 owner 名（随导出事件回传） */
  sourceApp?: string;
}

const MIN_SELECTION = 3;
/**
 * 窗口捕获的「原地点击」判定：按下后位移小于该值才采纳整窗，
 * 超过即转为普通框选 —— 否则悬停在窗口上就画不了自定义选区了。
 */
const WINDOW_CLICK_THRESHOLD = 4;
/**
 * 悬停轮询间隔：枚举全窗口太频白烧 CPU，太慢高亮跟不上手。
 * get-windows 异步枚举单次约 33ms，64ms 轮询既跟手又不占满主进程。
 */
const HOVER_POLL_MS = 64;
/** 只等**第一块屏**（光标所在屏）就绪 —— 其余屏抓完各自补上，不卡首帧 */
const READY_TIMEOUT_MS = 2500;
/** 确认时若其余屏还没抓完，最多再等这么久（否则拼接会缺一块） */
const CAPTURE_WAIT_MS = 2500;
const PIN_TIMEOUT_MS = 8000;

export function createSnipper(opts: SnipOptions): Snipper {
  setLogger(opts.logger ?? console);
  const windowSnap = opts.windowSnap !== false;
  const hostActions: SnipAction[] = opts.actions ?? [];

  let session: Session | null = null;
  let hiddenWindows: BrowserWindow[] = [];
  let readyTimer: NodeJS.Timeout | null = null;
  /** 其余屏的抓屏 + 补窗；确认选区前要等它落地，否则拼接会缺一块 */
  let pendingRest: Promise<void> | null = null;
  const pinReadyWaiters = new Map<number, () => void>();
  /** 独立图片贴图：等 renderer 来 pin:boot 取数据 */
  const pendingImages = new Map<number, { png: Buffer; width: number; height: number; editMode: boolean }>();
  let uninstallIpc: (() => void) | null = null;
  let uninstallScreen: (() => void) | null = null;

  /** 接线只在窗口创建时做一次，见 overlay-window.ts 的说明。 */
  const overlayHooks: OverlayHooks = {
    onKey: (webContents, kind) => {
      // 文字输入框开着时，Enter / Esc 归渲染进程（提交 / 取消文字）
      if (session?.editText.has(webContents.id)) return;
      onOverlayInput(webContents, { kind });
    },
    onClosed: (contentsId) => {
      const s = session;
      if (!s) return;
      s.byContents.delete(contentsId);
      s.shotByContents.delete(contentsId);
      s.ready.delete(contentsId);
      s.overlays = s.overlays.filter((w) => !w.isDestroyed());
    },
  };

  const overlays = new OverlayPool({ preloadPath: opts.preloadPath, rendererDir: opts.rendererDir }, overlayHooks);
  const pins = new PinRegistry({ preloadPath: opts.preloadPath, rendererDir: opts.rendererDir });

  // ---------------------------------------------------------------- 自家窗口

  function hideOwnWindows(): void {
    hiddenWindows = [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isVisible()) {
        win.hide();
        hiddenWindows.push(win);
      }
    }
  }

  /**
   * 恢复抓屏前隐藏的窗口。`keepHidden` 返回 true 的窗口继续留在列表里，
   * 下一次调用再恢复（钉住后宿主窗口要保持隐藏，只在「取消」时才回来）。
   */
  function restoreWindows(keepHidden: (win: BrowserWindow) => boolean): void {
    const remaining: BrowserWindow[] = [];
    for (const win of hiddenWindows) {
      if (win.isDestroyed()) continue;
      if (keepHidden(win)) {
        remaining.push(win);
        continue;
      }
      win.showInactive();
    }
    hiddenWindows = remaining;
  }

  /** 丢弃隐藏记录但不恢复窗口（确认截图后宿主窗口要继续隐藏）。 */
  function discardHidden(): void {
    hiddenWindows = [];
  }

  // ---------------------------------------------------------------- 选区广播

  /** 工具条挂哪块屏：选区中心所在屏；中心落在屏间空隙就退回光标所在屏。 */
  function toolbarDisplayFor(s: Session): number | null {
    if (s.phase !== 'adjusting' || !s.selection) return null;
    const sel = s.selection;
    const center = { x: sel.x + sel.width / 2, y: sel.y + sel.height / 2 };
    const displays = screen.getAllDisplays();
    const at = displays.find(
      (d) =>
        center.x >= d.bounds.x &&
        center.x < d.bounds.x + d.bounds.width &&
        center.y >= d.bounds.y &&
        center.y < d.bounds.y + d.bounds.height,
    );
    return (at ?? displayAtCursor(displays)).id;
  }

  function broadcast(): void {
    if (!session) return;
    const payload: OverlaySelectionPayload = {
      selection: session.selection,
      cursor: screen.getCursorScreenPoint(),
      outScale: session.selection ? resolveOutScale(session.shots, session.selection) : 1,
      phase: session.phase,
      toolbarDisplayId: toolbarDisplayFor(session),
      activeTool: session.activeTool,
      hoverRect: session.hoverRect,
    };
    for (const win of session.overlays) {
      if (!win.isDestroyed()) {
        win.webContents.send(CH.overlaySelection, payload);
      }
    }
  }

  function rectFrom(a: Point, b: Point): Rect {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function sameRect(a: Rect, b: Rect): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  // --------------------------------------------------- 悬停窗口捕获

  function startHoverPoll(s: Session): void {
    if (!windowSnap || s.hoverPoll) return;
    s.hoverPoll = setInterval(() => {
      void detectHoverWindow(s);
    }, HOVER_POLL_MS);
  }

  function stopHoverPoll(s: Session | null): void {
    if (!s) return;
    if (s.hoverPoll) clearInterval(s.hoverPoll);
    s.hoverPoll = null;
    s.hoverBusy = false;
  }

  /**
   * 检测光标下的应用窗口：按 z 序取第一个包含光标的窗口。
   * 自家进程已由 listWindowRects 排除（按 PID），否则满屏遮罩会永远命中自己。
   */
  async function detectHoverWindow(s: Session): Promise<void> {
    // 只有「还没框选、也没在拖」的 selecting 阶段做窗口捕获；窗口捕获
    // 待定（原地点击判定中）也要继续 —— 高亮跟着光标走，松手才采纳
    const hoverIdle = session === s && s.phase === 'selecting' && !s.selection && (!s.mode || s.mode.kind === 'window');
    if (!hoverIdle) {
      if (s.hoverRect && session === s) {
        s.hoverRect = null;
        broadcast();
      }
      return;
    }
    if (s.hoverBusy) return;
    s.hoverBusy = true;
    try {
      const cursor = screen.getCursorScreenPoint();
      const rects = (await listWindowRects(process.pid)).map((w) => w.rect);
      const candidates = rects.filter((dip) => pointInRect(dip, cursor));
      if (session !== s) return;
      // Tab 轮换：候选窗口数量变了（光标移动 / 开关窗口）就重置轮换位置
      if (candidates.length !== s.hoverCandidates.length) s.hoverIndex = 0;
      s.hoverCandidates = candidates;
      const rect = candidates[s.hoverIndex] ?? candidates[0] ?? null;
      const changed =
        (s.hoverRect === null) !== (rect === null) ||
        (rect !== null && s.hoverRect !== null && !sameRect(rect, s.hoverRect));
      if (changed) {
        s.hoverRect = rect;
        broadcast();
      }
    } catch (err) {
      // 原生模块加载失败等场景：只记一次，功能降级为普通框选
      if (!s.hoverErrorLogged) {
        s.hoverErrorLogged = true;
        log.error('[snip] 窗口检测不可用，已降级为普通框选', err);
      }
    } finally {
      s.hoverBusy = false;
    }
  }

  function fullDisplayAt(point: Point): Rect {
    return { ...displayAt(screen.getAllDisplays(), point).bounds };
  }

  /** 单击（选区过小）退化成「选中光标所在的整块屏」。 */
  function hasRealSelection(sel: Rect | null): sel is Rect {
    return !!sel && sel.width >= MIN_SELECTION && sel.height >= MIN_SELECTION;
  }

  function stopPoll(s: Session | null): void {
    if (!s) return;
    if (s.poll) clearInterval(s.poll);
    s.poll = null;
    s.mode = null;
  }

  /**
   * 起 16ms 轮询：三种拖动模式（重新框选 / 整体移动 / 拖手柄）都靠它实时更新。
   *
   * 选区只存在主进程，遮罩是纯投影 —— 不轮询就只能在 `up` 那帧画一次，
   * 看起来就是「按住不刷新、松手才动」。必须在 `mode` 设好之后调（本函数不清 mode）。
   */
  function startPoll(s: Session): void {
    if (s.poll) clearInterval(s.poll);
    s.poll = setInterval(() => {
      if (!session || !session.mode) return;
      applyDrag(session);
      broadcast();
    }, 16);
  }

  /** 每帧按当前模式用光标真相源重算选区；移动 / 调整夹回虚拟桌面（碰撞）。 */
  function applyDrag(s: Session): void {
    const mode = s.mode;
    if (!mode) return;
    const cur = screen.getCursorScreenPoint();
    if (mode.kind === 'window') {
      // 窗口捕获待定：位移过阈值转成普通框选（从原按下点起算），否则
      // 维持 selection = null，悬停高亮继续跟着光标走
      if (Math.hypot(cur.x - mode.anchor.x, cur.y - mode.anchor.y) >= WINDOW_CLICK_THRESHOLD) {
        s.mode = { kind: 'new', anchor: mode.anchor, prev: null };
        s.selection = rectFrom(mode.anchor, cur);
      }
      return;
    }
    if (mode.kind === 'new') {
      // 重新框选的两端都是光标，天然落在桌面内，无需夹取
      s.selection = rectFrom(mode.anchor, cur);
    } else if (mode.kind === 'move') {
      s.selection = clampRect(moveRect(mode.origin, mode.start, cur), s.virtualBounds);
    } else {
      s.selection = clampRect(resizeRect(mode.origin, mode.handle, cur), s.virtualBounds);
    }
  }

  /**
   * 松手收尾：
   * - 窗口捕获待定（原地点击）→ 采纳当前悬停窗口为选区；
   * - 位移不足的「new」按误点处理（有旧选区就还原，否则选中整屏），
   *   然后一律进入 adjusting —— 出 8 向手柄，Enter / 双击才确认。
   */
  function finishDrag(s: Session, mode: DragMode): void {
    if (mode.kind === 'window') {
      s.selection = s.hoverRect ? { ...s.hoverRect } : fullDisplayAt(mode.anchor);
      s.hoverRect = null;
      s.phase = 'adjusting';
      return;
    }
    if (mode.kind === 'new' && !hasRealSelection(s.selection)) {
      s.selection = mode.prev && hasRealSelection(mode.prev) ? mode.prev : fullDisplayAt(mode.anchor);
    }
    s.phase = 'adjusting';
  }

  // ---------------------------------------------------------------- 截图会话

  async function start(): Promise<void> {
    if (session) cancel('restart');

    // macOS 10.15+ 抓屏受「屏幕录制」权限管，缺失时截出来只有桌面壁纸 ——
    // 未授权就引导去系统设置，不起会话（非 darwin 恒通过）
    if (!(await ensureScreenCaptureAccess())) return;

    // 抓屏必须发生在任何遮罩窗口创建之前，否则会把自己截进去
    hideOwnWindows();
    opts.onStateChange?.(true);

    const displays = screen.getAllDisplays();
    overlays.prune(new Set(displays.map((d) => d.id)));

    // 光标所在屏优先落地，其余屏与它**并行**抓 —— 谁先回来谁先出遮罩，
    // 不再「全部屏抓完 + 全部窗口 ready」才显示
    const primary = displayAtCursor(displays);
    const rest = displays.filter((d) => d.id !== primary.id);
    const restPromise = Promise.all(rest.map(async (d) => ({ shots: await captureDisplays([d], displays) })));

    const t0 = performance.now();
    let primaryShots: DisplayShot[];
    try {
      primaryShots = await captureDisplays([primary], displays);
    } catch (err) {
      log.error('[snip] 抓屏失败', err);
      restPromise.catch((cause: unknown) => {
        log.error('[snip] 其余屏抓屏失败', cause);
      });
      restoreWindows(() => false);
      opts.onStateChange?.(false);
      opts.focusHost?.();
      return;
    }
    log.info(`[snip] 抓屏（光标屏）${Math.round(performance.now() - t0)}ms`);

    session = {
      shots: [...primaryShots],
      virtualBounds: unionBounds(displays),
      overlays: [],
      byContents: new Map(),
      shotByContents: new Map(),
      ready: new Set(),
      shown: false,
      mode: null,
      selection: null,
      poll: null,
      phase: 'selecting',
      pendingPin: null,
      pinLayout: null,
      activeTool: 'hand',
      editText: new Set(),
      shapesByContents: new Map(),
      inFlightByContents: new Map(),
      hoverRect: null,
      hoverPoll: null,
      hoverBusy: false,
      hoverErrorLogged: false,
      hoverCandidates: [],
      hoverIndex: 0,
      startedAt: performance.now(),
    };

    spawnOverlays(primaryShots);
    startHoverPoll(session);

    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (session && !session.shown) {
        cancel('overlay-timeout');
      }
    }, READY_TIMEOUT_MS);

    const own = session;
    // 来源应用：此刻 z 序最前的非自家窗口（按 PID 已排除自家）；异步采录
    void listWindowRects(process.pid)
      .then((list) => {
        if (session === own) own.sourceApp = list[0]?.owner;
      })
      .catch((err: unknown) => log.warn('[snip] 来源应用探测失败', err));
    pendingRest = restPromise
      .then((list) => {
        // 会话可能已经取消 / 重启，别把旧抓屏结果塞进新会话
        if (!own || session !== own) return;
        for (const { shots } of list) {
          own.shots.push(...shots);
          spawnOverlays(shots);
        }
        // 迟到的窗口要能立刻看到当前选区
        broadcast();
      })
      .catch((err: unknown) => log.error('[snip] 其余屏抓屏失败', err))
      .then(() => {
        pendingRest = null;
        // 宿主窗口（此前截到的钉图等）等**所有屏都抓完**再放回来，
        // 否则它们可能出现在还没抓的那块屏的截图里
        if (!session || session === own) {
          restoreWindows((win) => opts.keepHiddenAfterPin?.(win) ?? false);
        }
      });
  }

  /** 建（或复用）遮罩窗口并加载页面；窗口加载完成前不参与 ready 判定。 */
  function spawnOverlays(shots: DisplayShot[]): void {
    const s = session;
    if (!s) return;
    for (const shot of shots) {
      const { win, load } = overlays.acquire(shot);
      s.overlays.push(win);
      s.byContents.set(win.webContents.id, win);
      s.shotByContents.set(win.webContents.id, shot);
      void load.catch((err: unknown) => {
        log.error('[snip] 遮罩加载失败', err);
      });
    }
  }

  /** renderer 调 overlay:boot 时返回它自己那块屏的截图。 */
  function onOverlayBoot(sender: WebContents): OverlayInitPayload | null {
    if (!session) return null;
    const shot = session.shotByContents.get(sender.id);
    if (!shot) return null;
    const actions = hostActions.map(({ id, label, icon, danger, primary }) => ({ id, label, icon, danger, primary }));
    return { shot, virtualBounds: session.virtualBounds, actions };
  }

  function onOverlayReady(sender: WebContents): void {
    const s = session;
    if (!s) return;
    const win = s.byContents.get(sender.id);
    if (!win || win.isDestroyed()) return;

    s.ready.add(sender.id);
    // 第一个就绪的窗口（= 光标所在屏）立刻显示并拿走焦点，
    // 其余窗口就绪一个显示一个，不互相等
    const first = !s.shown;
    s.shown = true;
    if (first) {
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      log.info(`[snip] 触发 → 首窗 ready 总耗时 ${Math.round(performance.now() - s.startedAt)}ms`);
      win.show();
      win.moveTop();
      overlayAtCursor()?.focus();
    } else {
      win.show();
      win.moveTop();
    }
    // 迟到的窗口要能立刻拿到当前选区状态
    broadcast();
    // 再补发其余屏**已提交**的标注 —— 那些广播发生在本窗口订阅之前，
    // 错过了就永远看不到（A 屏先画完、B 屏遮罩才加载完就是这种顺序）
    for (const contentsId of s.shapesByContents.keys()) {
      if (contentsId === sender.id) continue;
      const shot = s.shotByContents.get(contentsId);
      if (!shot) continue;
      const payload: OverlayRemoteShapesPayload = {
        fromDisplayId: shot.displayId,
        shapes: visibleRemoteShapes(s, contentsId).map((shape) => mapShape(shape, shot.bounds.x, shot.bounds.y, 1)),
      };
      win.webContents.send(CH.overlayRemoteShapes, payload);
    }
  }

  function overlayAtCursor(): BrowserWindow | null {
    if (!session) return null;
    const d = displayAtCursor(screen.getAllDisplays());
    const win = session.overlays.find((w) => !w.isDestroyed() && sameRect(w.getBounds(), d.bounds));
    return win ?? null;
  }

  function onOverlayInput(sender: WebContents, payload: OverlayInput): void {
    const s = session;
    if (!s || s.phase === 'confirming') return;
    if (!s.byContents.has(sender.id)) return;

    switch (payload.kind) {
      case 'down': {
        const p = screen.getCursorScreenPoint();
        stopPoll(s);

        // 已有选区时先判断这一下是调手柄、整体移动，还是重新框选
        const prev = s.selection;
        if (s.phase === 'adjusting' && prev && hasRealSelection(prev)) {
          // 手柄（12 DIP 8 点）优先，边框中段（6 DIP 带）兜底 —— 与遮罩
          // 渲染端 hitResizeZone 同一组合，光标说能调按下去就得能调
          const handle = hitHandle(prev, p) ?? hitBorder(prev, p);
          if (handle) {
            s.mode = { kind: 'resize', origin: { ...prev }, handle, start: p };
            startPoll(s);
            broadcast();
            break;
          }
          if (pointInRect(prev, p)) {
            s.mode = { kind: 'move', origin: { ...prev }, start: p };
            startPoll(s);
            broadcast();
            break;
          }
        }

        // 尚无选区且光标悬停在应用窗口上：进入「窗口捕获待定」——
        // 原地点击（位移小于阈值）= 采纳整窗；按住拖动 = 转普通框选，
        // 自定义选区不会被窗口捕获挡死
        if (!prev && s.hoverRect && pointInRect(s.hoverRect, p)) {
          s.mode = { kind: 'window', anchor: p };
          startPoll(s);
          break;
        }

        // 重新框选：回到 selecting（手柄收起来），旧选区留着以便误点时还原
        s.phase = 'selecting';
        s.selection = { x: p.x, y: p.y, width: 0, height: 0 };
        s.mode = { kind: 'new', anchor: p, prev: prev ?? null };
        startPoll(s);
        broadcast();
        break;
      }
      case 'up': {
        const mode = s.mode;
        if (!mode) break;
        // 松手这一帧以光标真相源补算一次：16ms 轮询最多落后一个 tick，
        // 否则快速拖动时选区会停在释放点之前
        applyDrag(s);
        stopPoll(s);
        finishDrag(s, mode);
        broadcast();
        break;
      }
      case 'dblclick':
      case 'enter': {
        if (!hasRealSelection(s.selection)) {
          s.selection = fullDisplayAt(screen.getCursorScreenPoint());
        }
        // 主流语义：双击 / Enter = **复制**（不是「确认进钉图」）
        requestExport('copy');
        break;
      }
      case 'nudge': {
        // 方向键微调选区：1px（Shift=10px）粒度由渲染端给，主进程负责
        // 碰撞钳制 —— 拖动 / 待定 / 非 adjusting 阶段一律不生效
        if (s.phase !== 'adjusting' || s.mode) break;
        const sel = s.selection;
        if (!hasRealSelection(sel)) break;
        s.selection = clampRect({ ...sel, x: sel.x + payload.dx, y: sel.y + payload.dy }, s.virtualBounds);
        broadcast();
        break;
      }
      case 'cycle-window': {
        // Tab 轮换光标下的重叠窗口（窗口捕获阶段）
        if (s.phase !== 'selecting' || s.selection || s.mode) break;
        const list = s.hoverCandidates;
        if (list.length < 2) break;
        s.hoverIndex = (s.hoverIndex + 1) % list.length;
        s.hoverRect = list[s.hoverIndex];
        broadcast();
        break;
      }
      case 'escape':
        cancel('escape');
        break;
      case 'context':
        cancel('context-menu');
        break;
    }
  }

  // --------------------------------------------------- 遮罩阶段的标注

  /** 遮罩换了标注工具：记下来并广播给其余遮罩（跨屏画图要用同一个工具）。 */
  function onOverlayTool(_sender: WebContents, tool: ToolId): void {
    const s = session;
    if (!s || s.activeTool === tool) return;
    s.activeTool = tool;
    broadcast();
  }

  /**
   * 遮罩工具条的动作。**没有「确定」** —— 复制 / 保存在遮罩里就地合成
   * （主进程只把数据推过去，拼图由遮罩渲染进程做），完成后回传 PNG。
   * 内置动作之外的 id 派发给宿主注册的 `actions`。
   */
  function onOverlayAction(sender: WebContents, id: string): void {
    const s = session;
    if (!s || s.phase === 'confirming') return;
    if (!s.byContents.has(sender.id)) return;
    log.info(`[snip] 遮罩工具条动作 kind=${id} phase=${s.phase}`);
    if (id === 'cancel') {
      cancel('toolbar');
      return;
    }
    if (id === 'pin') {
      void confirmSnip();
      return;
    }
    if (id === 'copy' || id === 'save') {
      requestExport(id);
      return;
    }
    const action = hostActions.find((a) => a.id === id);
    if (!action) {
      log.warn(`[snip] 未知的工具条动作 ${id}`);
      return;
    }
    void runHostAction(s, action, sender);
  }

  async function runHostAction(s: Session, action: SnipAction, sender: WebContents): Promise<void> {
    const sel = s.selection;
    if (!hasRealSelection(sel)) return;
    const ctx: SnipActionContext = {
      selection: sel,
      shots: s.shots,
      pickSingleDisplay: () => {
        const pick = bestRegionOnDisplay(s.shots, sel);
        return pick ? { shot: s.shots[pick.index], region: pick.region } : null;
      },
      hideOverlays: () => hideOverlays(),
      end: (reason = 'action') => cancel(reason),
      showResult: (result) => {
        if (!sender.isDestroyed()) sender.send(CH.overlayPanel, result);
      },
    };
    try {
      await action.run(ctx);
    } catch (err) {
      log.error(`[snip] 动作 ${action.id} 失败`, err);
      ctx.showResult({ state: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * 把合成数据推给「工具条所在屏」的那块遮罩，由它就地拼图 + 画标注后回传。
   * 只推给一块：拼图一次就够，其余遮罩只负责各自的标注（已含在 `shapes` 里）。
   */
  function requestExport(kind: 'copy' | 'save'): void {
    void runExport(kind);
  }

  async function runExport(kind: 'copy' | 'save'): Promise<void> {
    const s = session;
    if (!s || !hasRealSelection(s.selection)) {
      log.warn(`[snip] 导出被拒绝：没有有效选区 kind=${kind}`);
      return;
    }
    // 拖动过程中（Enter / 双击）触发的导出：先定住选区，别让 16ms 轮询继续改它
    stopPoll(s);
    s.phase = 'adjusting';
    broadcast();

    // 分批抓屏可能还没补完 —— 与 confirmSnip 同一个坑：不等的话，
    // 晚到那块屏在拼接里就是空的
    if (pendingRest) {
      await Promise.race([pendingRest, new Promise((resolve) => setTimeout(resolve, CAPTURE_WAIT_MS))]);
      if (session !== s) return; // 等待期间被取消 / 重开过会话
    }

    const hostDisplayId = toolbarDisplayFor(s);
    const data: OverlayComposePayload = {
      shots: s.shots,
      selection: s.selection,
      outScale: resolveOutScale(s.shots, s.selection),
      shapes: toImageShapes(s),
    };
    for (const [contentsId, shot] of s.shotByContents) {
      if (shot.displayId !== hostDisplayId) continue;
      const win = s.byContents.get(contentsId);
      if (!win || win.isDestroyed()) continue;
      log.info(`[snip] 请求就地合成 kind=${kind} host=${hostDisplayId} shapes=${data.shapes.length}`);
      win.webContents.send(CH.overlayCompose, { kind, data });
      return;
    }
    log.warn(`[snip] 请求就地合成失败：找不到宿主遮罩 display=${hostDisplayId}`);
  }

  /**
   * 遮罩合成好的 PNG：**先收遮罩、恢复窗口**，再进剪贴板 / 弹存盘框 ——
   * 否则满屏置顶的遮罩会把保存对话框压在下面。
   */
  async function onOverlayExport(
    sender: WebContents,
    kind: 'copy' | 'save',
    png: Uint8Array,
  ): Promise<PinActionResult> {
    if (!session) return { ok: false, error: '截图会话已结束' };
    if (png.byteLength === 0) return { ok: false, error: '图片数据为空' };
    // 来源应用要赶在 cancel 前取（收场之后会话就没了）
    const sourceApp = session.sourceApp;
    const win = BrowserWindow.fromWebContents(sender);
    cancel(kind === 'copy' ? 'copy' : 'save');
    return deliver(kind, png, win, sourceApp);
  }

  /** 导出的统一出口：宿主 onExport 优先，否则走包内默认的剪贴板 / 保存框。 */
  async function deliver(
    kind: 'copy' | 'save',
    png: Uint8Array,
    win: BrowserWindow | null,
    sourceApp?: string,
    suggestedName?: string,
  ): Promise<PinActionResult> {
    try {
      if (opts.onExport) {
        const ok = await opts.onExport({ kind, png, sourceApp });
        return ok === false ? { ok: false, error: '已取消' } : { ok: true };
      }
      if (kind === 'copy') {
        await copyPng(png);
        log.info(`[snip] 已复制 ${png.byteLength} 字节`);
        return { ok: true };
      }
      const saved = await savePng(win, png, {
        saveDir: opts.saveDir,
        format: opts.saveFormat,
        suggestedName: suggestedName ?? defaultSnipName(opts.saveFormat),
      });
      return saved ? { ok: true } : { ok: false, error: '已取消保存' };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`[snip] 导出失败 kind=${kind}`, err);
      return { ok: false, error };
    }
  }

  /** 遮罩回传本屏标注（本屏 DIP）。只在历史变化时调，不是每帧。 */
  function onOverlayShapes(sender: WebContents, shapes: Shape[]): void {
    const s = session;
    if (!s) return;
    s.shapesByContents.set(sender.id, shapes);
    broadcastRemoteShapes(s, sender.id);
  }

  /** 遮罩回传本屏拖画中的草稿（本屏 DIP）。拖画期间按帧合并成一条。 */
  function onOverlayDraft(sender: WebContents, draft: Shape | null): void {
    const s = session;
    if (!s) return;
    broadcastRemoteDraft(s, sender.id, draft);
  }

  /**
   * 遮罩回传本屏正在拖动 / 缩放的标注下标。主进程**照存全量快照**
   * （导出 / 钉图用它，无需兜底），只在对其余遮罩广播时把这条滤掉，
   * 其余屏改画拖动副本 —— 不滤的话旧位、新位会叠着画两份。
   */
  function onOverlayInFlight(sender: WebContents, index: number | null): void {
    const s = session;
    if (!s) return;
    s.inFlightByContents.set(sender.id, index);
    broadcastRemoteShapes(s, sender.id);
  }

  /** 某个遮罩当前应被其余屏看到的标注：全量快照滤掉拖动中的那条。 */
  function visibleRemoteShapes(s: Session, contentsId: number): Shape[] {
    const shapes = s.shapesByContents.get(contentsId) ?? [];
    const inFlight = s.inFlightByContents.get(contentsId);
    // 0 也是合法下标，判空必须用 != null
    return inFlight != null ? shapes.filter((_, i) => i !== inFlight) : shapes;
  }

  /**
   * 把某个遮罩的本屏标注换算成虚拟屏 DIP 并广播给**其余遮罩**。
   *
   * 一条标注从 A 屏画到 B 屏时，A 的窗口只会画出落在 A 的半截，
   * B 屏那半截得靠 B 自己的遮罩补出来 —— 每块屏一个窗口、画布互相独立，
   * 不广播的话 B 永远是空的。接收方减去自己那块屏的原点即是局部坐标。
   */
  function broadcastRemoteShapes(s: Session, senderId: number): void {
    const shot = s.shotByContents.get(senderId);
    if (!shot) return;
    const payload: OverlayRemoteShapesPayload = {
      fromDisplayId: shot.displayId,
      shapes: visibleRemoteShapes(s, senderId).map((shape) => mapShape(shape, shot.bounds.x, shot.bounds.y, 1)),
    };
    for (const win of s.overlays) {
      if (win.isDestroyed() || win.webContents.id === senderId) continue;
      win.webContents.send(CH.overlayRemoteShapes, payload);
    }
  }

  /** 同上，但走的是草稿通道；`draft` 为 null 表示来源屏的草稿已结束。 */
  function broadcastRemoteDraft(s: Session, senderId: number, draft: Shape | null): void {
    const shot = s.shotByContents.get(senderId);
    if (!shot) return;
    const payload: OverlayRemoteDraftPayload = {
      fromDisplayId: shot.displayId,
      draft: draft ? mapShape(draft, shot.bounds.x, shot.bounds.y, 1) : null,
    };
    for (const win of s.overlays) {
      if (win.isDestroyed() || win.webContents.id === senderId) continue;
      win.webContents.send(CH.overlayRemoteDraft, payload);
    }
  }

  /** 文字输入框开合 —— 打字时 Enter / Esc 交给渲染进程，别被会话吃掉。 */
  function onOverlayEditState(sender: WebContents, textEditing: boolean): void {
    const s = session;
    if (!s) return;
    if (textEditing) s.editText.add(sender.id);
    else s.editText.delete(sender.id);
  }

  /**
   * 遮罩阶段的标注是**本屏 DIP**，确认时换算成图像像素：
   * `(本屏 DIP + 本屏原点 - 选区原点) × outScale`，线宽 / 字号一起放大。
   * 存 DIP 而不是提前换算，是因为选区在调整阶段还会变，`outScale` 也跟着变。
   */
  function toImageShapes(s: Session): Shape[] {
    const sel = s.selection;
    if (!sel) return [];
    const k = resolveOutScale(s.shots, sel);
    const out: Shape[] = [];
    for (const [contentsId, shapes] of s.shapesByContents) {
      const shot = s.shotByContents.get(contentsId);
      if (!shot) continue;
      const dx = shot.bounds.x - sel.x;
      const dy = shot.bounds.y - sel.y;
      for (const shape of shapes) out.push(mapShape(shape, dx, dy, k));
    }
    return out;
  }

  // ---------------------------------------------------------------- 确认 / 取消

  async function confirmSnip(): Promise<void> {
    const s = session;
    if (!s || s.phase === 'confirming' || !hasRealSelection(s.selection)) {
      return;
    }

    // 分批抓屏可能还没补完：不等的话，晚到那块屏在拼接里就是空的
    if (pendingRest) {
      await Promise.race([pendingRest, new Promise((resolve) => setTimeout(resolve, CAPTURE_WAIT_MS))]);
      // 等待期间用户可能 Esc / 重开过会话
      if (session !== s) return;
    }

    const selection = s.selection;
    const outScale = resolveOutScale(s.shots, selection);
    log.info(
      `[snip] 确认选区 dip=${Math.round(selection.x)},${Math.round(selection.y)} ` +
        `${Math.round(selection.width)}x${Math.round(selection.height)} outScale=${outScale}`,
    );
    s.phase = 'confirming';
    stopPoll(s);

    const layout = computePinLayout(selection, screen.getAllDisplays());
    s.pinLayout = layout;
    log.info(
      `[snip] 钉图布局 pad=${JSON.stringify(layout.padding)} bounds=${layout.bounds.width}x` +
        `${layout.bounds.height}@${layout.bounds.x},${layout.bounds.y}`,
    );

    const pin = pins.create(layout.bounds);
    s.pendingPin = pin;
    const pinId = pin.webContents.id;

    // renderer 自己通过 pin:boot 拉取数据并拼接，就绪后回调 pin:ready
    let settle: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const state = { ok: false };

    const fail = () => {
      pinReadyWaiters.delete(pinId);
      settle();
    };
    pinReadyWaiters.set(pinId, () => {
      state.ok = true;
      settle();
    });

    void pins.load(pin).catch((err: unknown) => {
      log.error('[snip] 钉图窗口加载失败', err);
      fail();
    });
    const timer = setTimeout(fail, PIN_TIMEOUT_MS);

    await finished;
    clearTimeout(timer);
    pinReadyWaiters.delete(pinId);

    if (!state.ok || pin.isDestroyed()) {
      log.warn('[snip] 钉图未就绪，取消本次截图');
      if (!pin.isDestroyed()) pin.close();
      cancel('pin-timeout');
      return;
    }

    log.info('[snip] 钉图就绪，替换遮罩');
    // 遮罩销毁与钉图显示放在同一 tick，避免闪白
    hideOverlays();
    pin.showInactive();
    pin.focus();
    session = null;
    // 确认后宿主窗口继续保持隐藏，只把抓屏前隐藏的钉图放回来
    discardHidden();
    opts.onStateChange?.(false);
  }

  /** renderer 拼接完成并调用 pin:ready 时，唤醒 confirmSnip 的等待。 */
  function markPinReady(sender: WebContents): void {
    const resolve = pinReadyWaiters.get(sender.id);
    if (resolve) {
      pinReadyWaiters.delete(sender.id);
      resolve();
    }
  }

  /** pin:boot 的「独立图片」分支：取走挂在本窗口上的图片数据。 */
  function takePendingImage(sender: WebContents): PinBootPayload | null {
    const pending = pendingImages.get(sender.id);
    if (!pending) return null;
    pendingImages.delete(sender.id);
    return {
      kind: 'image',
      png: new Uint8Array(pending.png),
      width: pending.width,
      height: pending.height,
      editMode: pending.editMode,
    };
  }

  async function pinImage(png: Uint8Array, o: { editMode?: boolean } = {}): Promise<void> {
    const img = nativeImage.createFromBuffer(Buffer.from(png));
    if (img.isEmpty()) throw new Error('图片数据为空');
    const { width, height } = img.getSize();
    // 图片超过工作区 70% 就等比缩小，居中落在主屏上
    const wa = screen.getPrimaryDisplay().workArea;
    const scale = Math.min(1, (wa.width * 0.7) / width, (wa.height * 0.7) / height);
    const w = Math.max(120, Math.round(width * scale));
    const h = Math.max(90, Math.round(height * scale));
    const bounds = {
      x: wa.x + Math.round((wa.width - w) / 2),
      y: wa.y + Math.round((wa.height - h) / 2),
      width: w,
      height: h,
    };
    const pin = pins.create(bounds);
    pendingImages.set(pin.webContents.id, { png: Buffer.from(png), width: w, height: h, editMode: !!o.editMode });
    // 与截图钉住同一规则：renderer 拼好（这里是解码）后才显示，避免闪白
    const ready = new Promise<void>((resolve) => pinReadyWaiters.set(pin.webContents.id, resolve));
    await pins.load(pin);
    await ready;
    pinReadyWaiters.delete(pin.webContents.id);
    if (!pin.isDestroyed()) pin.showInactive();
  }

  /** renderer 调 pin:boot 时拿到拼接所需的全部数据。 */
  function onPinBoot(sender: WebContents): PinBootPayload | null {
    const s = session;
    if (!s && pendingImages.has(sender.id)) return takePendingImage(sender);
    if (!s || s.pendingPin?.webContents.id !== sender.id) {
      log.warn(
        `[snip] pin:boot 被拒绝 sender=${sender.id} phase=${s?.phase ?? 'none'} pending=${s?.pendingPin?.webContents.id ?? 'none'}`,
      );
      return null;
    }
    if (!hasRealSelection(s.selection)) {
      log.warn('[snip] pin:boot 被拒绝：选区无效');
      return null;
    }
    return {
      kind: 'snip',
      shots: s.shots,
      selection: s.selection,
      outScale: resolveOutScale(s.shots, s.selection),
      dipWidth: s.selection.width,
      dipHeight: s.selection.height,
      padding: s.pinLayout?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 },
      // 遮罩阶段画的标注（已换算），钉图 seed 进去继续可编辑
      initialShapes: toImageShapes(s),
    };
  }

  /** 贴图窗口的动作（按钮 / 快捷键 / 滚轮）。 */
  async function onPinAction(sender: WebContents, payload: PinAction): Promise<PinActionResult> {
    const win = BrowserWindow.fromWebContents(sender);
    if (!win || win.isDestroyed()) return { ok: false, error: '窗口已关闭' };
    try {
      switch (payload.kind) {
        case 'copy':
          return await deliver('copy', payload.png, win);
        case 'save':
          return await deliver('save', payload.png, win, undefined, payload.suggestedName);
        case 'close':
          win.close();
          return { ok: true };
        case 'zoom':
          pins.zoom(win, payload.factor);
          return { ok: true };
        case 'opacity':
          pins.opacity(win, payload.delta);
          return { ok: true };
        case 'ignore':
          pins.toggleMouseIgnore(win);
          return { ok: true };
        default:
          return { ok: false, error: '未知操作' };
      }
    } catch (err) {
      log.error('[pin] 操作失败', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 收起遮罩但**不销毁**：窗口按 displayId 缓存，下次截图复用，
   * 省掉重建窗口 + 重新加载页面的开销。
   */
  function hideOverlays(): void {
    if (!session) return;
    stopPoll(session);
    stopHoverPoll(session);
    const list = session.overlays;
    session.overlays = [];
    for (const win of list) {
      if (win.isDestroyed()) continue;
      // 让渲染进程丢掉全屏位图 —— 窗口要留着复用，位图不该一直占着显存
      win.webContents.send(CH.overlayTeardown, { reason: 'confirm' });
      win.hide();
    }
  }

  function cancel(reason = 'manual'): void {
    const s = session;
    if (s) log.info(`[snip] 取消截图 (${reason}) phase=${s.phase}`);
    session = null;
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (s) {
      stopPoll(s);
      stopHoverPoll(s);
      for (const win of s.overlays) {
        if (win.isDestroyed()) continue;
        // teardown 让渲染进程丢掉全屏位图（窗口留着复用，不该一直占着显存）
        win.webContents.send(CH.overlayTeardown, { reason: 'cancel' });
        win.hide();
      }
      if (s.pendingPin && !s.pendingPin.isDestroyed()) s.pendingPin.close();
    }
    for (const resolve of pinReadyWaiters.values()) resolve();
    pinReadyWaiters.clear();

    const hadSession = !!s;
    restoreWindows(() => false);
    if (hadSession) {
      opts.onStateChange?.(false);
      opts.focusHost?.();
    }
  }

  // ---------------------------------------------------------------- 对外

  const handlers: SnipHandlers = {
    overlayBoot: (sender) => onOverlayBoot(sender),
    overlayReady: (sender) => onOverlayReady(sender),
    overlayInput: (sender, payload) => onOverlayInput(sender, payload),
    overlayTool: (sender, tool) => onOverlayTool(sender, tool),
    overlayAction: (sender, id) => onOverlayAction(sender, id),
    overlayShapes: (sender, shapes) => onOverlayShapes(sender, shapes),
    overlayDraft: (sender, draft) => onOverlayDraft(sender, draft),
    overlayInFlight: (sender, index) => onOverlayInFlight(sender, index),
    overlayEditState: (sender, textEditing) => onOverlayEditState(sender, textEditing),
    overlayExport: (sender, kind, png) => onOverlayExport(sender, kind, png),
    overlayFocus: (sender) => {
      const win = BrowserWindow.fromWebContents(sender);
      if (win && win.isVisible()) win.focus();
    },
    overlayCopyText: async (text) => {
      try {
        copyText(text);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    pinBoot: (sender) => onPinBoot(sender),
    pinReady: (sender) => markPinReady(sender),
    pinAction: (sender, payload) => onPinAction(sender, payload),
  };

  return {
    start,
    cancel,
    pinImage,
    install(target: IpcMain): () => void {
      // 屏幕变化（分辨率 / 拔插）时正在进行的截图无法再对齐，直接收场
      const onDisplayChange = () => {
        if (session) cancel('display-changed');
      };
      screen.on('display-metrics-changed', onDisplayChange);
      screen.on('display-removed', onDisplayChange);
      uninstallScreen = () => {
        screen.off('display-metrics-changed', onDisplayChange);
        screen.off('display-removed', onDisplayChange);
      };
      uninstallIpc = installIpc(target, handlers);
      return () => {
        uninstallScreen?.();
        uninstallIpc?.();
      };
    },
    dispose(): void {
      cancel('dispose');
      uninstallScreen?.();
      uninstallIpc?.();
      overlays.destroyAll();
      pins.closeAll();
    },
  };
}
