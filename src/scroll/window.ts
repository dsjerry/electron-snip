import { BrowserWindow, screen } from 'electron';
import type { WebContents } from 'electron';
import path from 'node:path';
import { captureDisplays } from '../main/capture';
import { forwardRendererLogs } from '../main/log';
import { ensureAccessibilityAccess } from '../main/permission';
import { pointInRect } from '../shared/selection';
import { CH } from '../shared/channels';
import { cropShot } from '../shared/crop';
import { placeBar } from '../shared/placement';
import { log } from '../main/log';
import { MAC_INJECTION_HINT, macAccessibilityTrusted, prepareAutoScroll, type ScrollInjector } from './injector';
import type {
  DisplayShot,
  Rect,
  ScrollActionResult,
  ScrollActionPayload,
  ScrollMinimapPayload,
  ScrollSpeed,
} from '../shared/types';

/** 长图运行所需的路径：preload（用于控制条 / 小地图的 IPC）与渲染资源目录。 */
export interface ScrollConfig {
  preloadPath: string;
  rendererDir: string;
}

let cfg: ScrollConfig = { preloadPath: '', rendererDir: '' };

/**
 * 滚动截长图（参考 QQ / PixPin 的手动滚动模式）。
 *
 * 进入后**收起全屏遮罩** —— 用户要看到并滚动真实窗口，遮罩盖着就什么都
 * 动不了。取而代之的是几个专用窗口：
 * - 轮廓窗：透明 + 全局点击穿透（`setIgnoreMouseEvents`），框外压暗、
 *   边框画在区域**外侧**（CSS outline）—— 边框像素落在裁剪区之外，
 *   无论 contentProtection 是否对本应用的抓屏生效都不会污染帧内容；
 * - 控制条：状态（已捕获尺寸）+ 复制 / 保存 / 取消，拼接逻辑在它的
 *   渲染进程里（行签名重叠匹配，见 `src/scroll/scroll.ts`）；
 * - 小地图：贴在选区旁的竖向缩略窗，实时显示拼接进度与当前视口框
 *   （快照由控制条渲染进程合成上行，本进程只转发）。
 *
 * 主进程只负责节奏：每帧抓屏 → 按选区裁出 RGBA 条带 → 推给控制条。
 * 只支持**单屏选区**：长图沿竖向滚动，跨屏选区没有意义。
 */

const FRAME_INTERVAL_MS = 250;
/** 窗口比 .bar 的可视区大 8px，给圆角和投影留呼吸空间（见 scroll.css） */
const BAR_WIDTH = 560;
const BAR_HEIGHT = 88;
/** 小地图窗口宽（DIP，含 8px 内边距）与它和选区的间距 */
const MAP_WIDTH = 112;
const MAP_GAP = 12;

interface ScrollState {
  bar: BrowserWindow;
  outline: BrowserWindow;
  /** 小地图窗口；选区两侧都放不下时为 null（不视为错误） */
  minimap: BrowserWindow | null;
  /** 抓帧定时器：用户点「开始」后才创建，点「长图」只进入准备状态 */
  timer: NodeJS.Timeout | null;
  displayId: number;
  region: Rect;
  /** 控制条位置（虚拟屏 DIP）—— 自动滚动注入的豁免区 */
  barBounds: Rect;
  busy: boolean;
}

let state: ScrollState | null = null;

export function isScrolling(): boolean {
  return state !== null;
}

/**
 * 启动滚动捕获。`shot` 必须是包含选区那块屏的截图，`region` 为该屏内
 * 的选区（虚拟屏 DIP）。返回 false 表示已在滚动中。
 *
 * `state` 在任何 await 之前同步赋值 —— 页面加载期间用户可能 Ctrl+Shift+A
 * 重启会话，cancelSnip → stopScrollCapture 必须能立刻杀掉这些窗口。
 */
export function startScrollCapture(shot: DisplayShot, region: Rect, config: ScrollConfig): boolean {
  if (state) return false;
  cfg = config;
  const d = screen.getAllDisplays().find((x) => x.id === shot.displayId);
  if (!d) return false;

  // ---- 轮廓窗：透明 + 点击穿透，纯视觉，无脚本（data URL 内联样式）
  const outline = new BrowserWindow({
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    thickFrame: false,
    hasShadow: false,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    fullscreenable: false,
    focusable: false,
    webPreferences: {},
  });
  outline.setAlwaysOnTop(true, 'screen-saver');
  outline.setContentProtection(true);
  outline.setIgnoreMouseEvents(true);

  // ---- 控制条：状态 + 动作按钮，拼接在它的渲染进程里
  // transparent 窗口不要设 backgroundColor —— 某些版本会因此垫一层
  // 不透明的合成面，页面的透明区域就变成「额外的背景色」
  const bar = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    frame: false,
    show: false,
    resizable: false,
    thickFrame: false,
    hasShadow: false,
    skipTaskbar: true,
    transparent: true,
    fullscreenable: false,
    webPreferences: {
      preload: cfg.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.setContentProtection(true);
  forwardRendererLogs(bar, 'scroll');
  const barRect = placeBar(region, d.bounds, { width: BAR_WIDTH, height: BAR_HEIGHT });
  bar.setBounds(barRect);

  // ---- 小地图：贴选区旁的竖向缩略窗（放不下就不出，纯增益不挡路）
  const mapRect = minimapBounds(region, d.bounds);
  const minimap = mapRect ? ensureMinimapWindow(mapRect) : null;

  state = {
    bar,
    outline,
    minimap,
    timer: null,
    displayId: shot.displayId,
    region,
    barBounds: barRect,
    busy: false,
  };

  // 页面加载完成再显示；加载期间抓的帧会被未就绪的页面丢弃，无副作用
  void outline
    .loadURL(outlineDataUrl(region, d.bounds))
    .then(() => {
      if (!outline.isDestroyed()) outline.showInactive();
    })
    .catch((err: unknown) => log.error('[scroll] 轮廓窗加载失败', err));
  void loadScrollPage(bar, 'bar')
    .then(() => {
      if (!bar.isDestroyed()) {
        bar.show();
        bar.focus();
      }
    })
    .catch((err: unknown) => log.error('[scroll] 控制条加载失败', err));

  log.info(
    `[scroll] 启动滚动截图 display=${shot.displayId} region=${Math.round(region.width)}x${Math.round(region.height)}`,
  );
  return true;
}

/**
 * 用户确认开始后才开始抓帧。点「长图」只打开控制条、不滚动、不抓帧 ——
 * 否则用户还没准备好就已经在拼接（甚至自动滚动），拼出来的内容不可控。
 */
export function beginScrollCapture(): boolean {
  const s = state;
  if (!s || s.timer) return false;
  s.timer = setInterval(() => void grabFrame(), FRAME_INTERVAL_MS);
  log.info('[scroll] 开始抓帧');
  return true;
}

/** 收起滚动捕获（窗口销毁 + 帧循环停止）。幂等。 */
export function stopScrollCapture(): void {
  stopAutoScroll();
  const s = state;
  if (!s) return;
  state = null;
  if (s.timer) clearInterval(s.timer);
  for (const win of [s.bar, s.outline, s.minimap]) {
    if (win && !win.isDestroyed()) win.destroy();
  }
  log.info('[scroll] 滚动截图已收起');
}

// ------------------------------------------------------------ 自动滚动

const AUTO_SCROLL_INTERVAL_MS = 500;
/** Windows：每个速度档对应的每次注入滚轮格数（一格 = WHEEL_DELTA 120） */
const AUTO_NOTCHES: Record<ScrollSpeed, number> = {
  slow: 1,
  normal: 3,
  fast: 6,
};
/**
 * macOS：每个速度档对应的滚动步长占视口高度的比例（CGEvent 像素单位，
 * 与选区 DIP 高度直接相乘）。**必须 ≤ 0.5**：相邻两帧的重叠要容得下探针，
 * 步长一旦超过半屏，拼接找不到锚点就整帧丢弃；这里按保守取值 ——
 * 自动滚动求稳不求快，可靠性优先于吞吐。
 */
const AUTO_STEP_FRACTION: Record<ScrollSpeed, number> = {
  slow: 0.3,
  normal: 0.4,
  fast: 0.5,
};
/** mac 最小步长（DIP）：选区太小时仍要能推动页面 */
const AUTO_STEP_MIN_DIP = 24;

let auto: {
  timer: NodeJS.Timeout;
  injector: ScrollInjector;
  /** 当前速度档的注入量：win32 = 滚轮格数，mac = DIP 像素步长（speed 可热切换） */
  amount: number;
  /** 上一拍的光标位置 —— 判断是用户在动鼠标还是程序上次的落点 */
  lastCursor: { x: number; y: number } | null;
} | null = null;
/** 自动滚动速度（未启动时切换也记着，启动即生效） */
let autoSpeed: ScrollSpeed = 'normal';

/**
 * 启动自动滚动。**只在启动时把光标放到选区中心一次** —— 之后绝不挪动
 * 光标：每拍检查光标位置，落在选区内（且不在控制条上）才注入滚轮。
 * 鼠标归用户管：移出选区 / 悬停控制条 = 自动暂停，移回来 = 自动恢复，
 * 不再出现「光标被拽回去、停不下来」的对抗。
 *
 * 返回动作回执：失败时 error 是给控制条提示的中文原因（辅助功能未授权等）。
 */
export async function startAutoScroll(): Promise<ScrollActionResult> {
  if (auto || !state) return { ok: false, error: '自动滚动已在进行中' };
  const session = state;
  // mac：注入受「辅助功能」权限管 —— 未授权先走引导框（授权立即生效），
  // 引导后再查一次，仍无权限就如实回执，控制条提示并保持手动模式
  if (process.platform === 'darwin' && !(await macAccessibilityTrusted())) {
    await ensureAccessibilityAccess();
    if (!(await macAccessibilityTrusted())) return { ok: false, error: MAC_INJECTION_HINT };
  }
  const prepared = await prepareAutoScroll();
  if (!prepared.ok) {
    log.warn(`[scroll] 自动滚动不可用：${prepared.reason}`);
    return { ok: false, error: prepared.reason };
  }
  // await 期间会话可能已被取消（或被重新开始）：此时不能再启动，否则留下没人清理的定时器，
  // 并且 auto 残留会让之后的会话永远无法自动滚动
  if (state !== session || auto) return { ok: false, error: '录制会话已结束' };
  const region = session.region;
  const bar = session.barBounds;
  // 启动时把光标放到选区中心一次，之后光标完全归用户管。
  // 坐标系按平台分：win32 SetCursorPos 吃物理像素；mac CGEvent 吃全局点（DIP）
  const centerDip = { x: region.x + region.width / 2, y: region.y + region.height / 2 };
  prepared.injector.place(process.platform === 'darwin' ? centerDip : screen.dipToScreenPoint(centerDip));
  const amount =
    process.platform === 'win32'
      ? AUTO_NOTCHES[autoSpeed]
      : Math.max(AUTO_STEP_MIN_DIP, Math.floor(region.height * AUTO_STEP_FRACTION[autoSpeed]));
  const timer = setInterval(() => {
    if (!state || !auto) return;
    const cursor = screen.getCursorScreenPoint();
    // 用户在动鼠标（与上一拍位置差 > 4 DIP）→ 本拍不注入：移向控制条
    // 的路上滚动立即停手，按钮随手就能点；停住不动才继续注入
    const moved =
      auto.lastCursor !== null && Math.hypot(cursor.x - auto.lastCursor.x, cursor.y - auto.lastCursor.y) > 4;
    auto.lastCursor = cursor;
    // 光标在选区内且不在控制条上才注入 —— 悬停控制条时滚轮会打在
    // 控制条自己身上，按钮就没法点了
    if (!moved && pointInRect(region, cursor) && !pointInRect(bar, cursor)) {
      auto.injector.stepDown(auto.amount);
    }
  }, AUTO_SCROLL_INTERVAL_MS);
  auto = {
    timer,
    injector: prepared.injector,
    amount,
    lastCursor: null,
  };
  log.info(`[scroll] 自动滚动已启动（${autoSpeed}）`);
  return { ok: true };
}

/** 切换自动滚动速度（快/中/慢改变每次注入的步长，热生效）。 */
export function setAutoScrollSpeed(speed: ScrollSpeed): void {
  autoSpeed = speed;
  if (auto && state) {
    auto.amount =
      process.platform === 'win32'
        ? AUTO_NOTCHES[speed]
        : Math.max(AUTO_STEP_MIN_DIP, Math.floor(state.region.height * AUTO_STEP_FRACTION[speed]));
  }
}

export function stopAutoScroll(): void {
  if (!auto) return;
  clearInterval(auto.timer);
  auto = null;
}

async function grabFrame(): Promise<void> {
  const s = state;
  if (!s || s.busy) return;
  s.busy = true;
  try {
    const d = screen.getAllDisplays().find((x) => x.id === s.displayId);
    if (!d) throw new Error('显示器已断开');
    const [shot] = await captureDisplays([d], screen.getAllDisplays(), true);
    const frame = cropShot(shot, s.region);
    if (s.bar.isDestroyed()) return;
    s.bar.webContents.send(CH.scrollFrame, frame);
  } catch (err) {
    log.error('[scroll] 抓帧失败', err);
  } finally {
    if (state === s) s.busy = false;
  }
}

/**
 * 小地图位置：优先贴选区右侧（与控制条同款 12px 间距），放不下翻左侧，
 * 两侧都没有（选区几乎占满屏宽）返回 null —— 不出小地图，绝不盖住选区。
 * 垂直与选区顶对齐、同高（**不给最低高度**：短选区再撑高会探进选区下方
 * 控制条的地盘把它压住），贴屏越界往上收。
 */
function minimapBounds(region: Rect, display: Rect): Electron.Rectangle | null {
  const height = Math.min(Math.round(region.height), display.height - 16);
  let x = Math.round(region.x + region.width + MAP_GAP);
  if (x + MAP_WIDTH > display.x + display.width - 8) {
    x = Math.round(region.x - MAP_GAP - MAP_WIDTH);
  }
  if (x < display.x + 8) return null;
  let y = Math.round(region.y);
  if (y + height > display.y + display.height - 8) {
    y = display.y + display.height - 8 - height;
  }
  return { x, y, width: MAP_WIDTH, height };
}

/**
 * 小地图窗口：透明、置顶、内容保护（同控制条 —— 绝不能出现在帧里），
 * 整窗点击穿透且**不参与焦点**：它是纯指示器，键盘（Esc）与滚轮都归
 * 真实页面 / 控制条。
 */
function ensureMinimapWindow(rect: Electron.Rectangle): BrowserWindow {
  const win = new BrowserWindow({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    thickFrame: false,
    hasShadow: false,
    skipTaskbar: true,
    // transparent 窗口不要设 backgroundColor —— 会垫一层不透明合成面（同控制条）
    transparent: true,
    fullscreenable: false,
    focusable: false,
    // 遮罩同款不变量（AGENTS.md）：选区贴屏顶时小地图可能探进菜单栏条带
    enableLargerThanScreen: true,
    webPreferences: {
      preload: cfg.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true);
  win.setIgnoreMouseEvents(true);
  forwardRendererLogs(win, 'scroll-minimap');
  void loadScrollPage(win, 'minimap')
    .then(() => {
      if (!win.isDestroyed()) win.showInactive();
    })
    .catch((err: unknown) => log.error('[scroll] 小地图加载失败', err));
  return win;
}

/**
 * 控制条上行的小地图快照 → 转发给小地图窗口。
 * 来源必须是控制条本尊（webContents.id 校验，防伪造 / 防串会话）。
 */
export function onScrollMinimap(sender: WebContents, payload: ScrollMinimapPayload): void {
  const s = state;
  if (!s || s.bar.isDestroyed() || s.bar.webContents.id !== sender.id) return;
  if (!s.minimap || s.minimap.isDestroyed()) return;
  s.minimap.webContents.send(CH.scrollMinimap, payload);
}

/** 轮廓页：区域本体全透明，压暗与边框都画在**区域外**，不污染抓帧。 */
function outlineDataUrl(region: Rect, display: Rect): string {
  const x = Math.round(region.x - display.x);
  const y = Math.round(region.y - display.y);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
    .hole {
      position: fixed;
      left: ${x}px; top: ${y}px;
      width: ${Math.round(region.width)}px; height: ${Math.round(region.height)}px;
      outline: 3px solid #2f6fed;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    }
  </style></head><body><div class="hole"></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * 控制条与小地图是**同一个 renderer 入口**（scroll.html）的两个角色：
 * hash 分发（`#minimap` = 小地图，其余 = 控制条），两者共享同一份
 * CSS / 脚本，拆成两个入口会多打一份。
 */
async function loadScrollPage(win: BrowserWindow, role: 'bar' | 'minimap'): Promise<void> {
  await win.loadFile(path.join(cfg.rendererDir, 'scroll.html'), { hash: role });
}

export interface ScrollFinish {
  kind: 'copy' | 'save' | 'edit';
  png: Uint8Array;
}

/**
 * 控制条的动作分发。导出（复制 / 保存）与「编辑」需要结束截图会话、再由宿主决定去向，
 * 所以这里只负责收起长图窗口，然后把结果交给宿主回调。
 * 返回回执：失败时 error 可直接展示（自动滚动权限 / 可用性问题）。
 */
export async function handleScrollAction(
  _sender: WebContents,
  payload: ScrollActionPayload,
  hooks: { onFinish(finish: ScrollFinish): void | Promise<void>; onCancel(reason: string): void },
): Promise<ScrollActionResult> {
  switch (payload.kind) {
    case 'start':
      beginScrollCapture();
      return { ok: true };
    case 'auto':
      return startAutoScroll();
    case 'manual':
      stopAutoScroll();
      return { ok: true };
    case 'speed':
      setAutoScrollSpeed(payload.speed ?? 'normal');
      return { ok: true };
    case 'bottom':
      stopAutoScroll();
      log.info('[scroll] 已到底部，自动滚动停止');
      return { ok: true };
    case 'cancel':
      stopScrollCapture();
      hooks.onCancel('scroll-cancel');
      return { ok: true };
    case 'edit':
    case 'copy':
    case 'save': {
      const png = payload.png;
      if (!png || png.byteLength === 0) {
        stopScrollCapture();
        hooks.onCancel('scroll-empty');
        return { ok: false, error: '没有可导出的内容' };
      }
      stopScrollCapture();
      void hooks.onFinish({ kind: payload.kind, png });
      return { ok: true };
    }
  }
}
