/**
 * 自动滚动的滚轮注入器（平台分支集中在主进程，见 AGENTS.md）。
 *
 * 「自动滚动」与真实滚轮没有区别：向系统输入队列注入向下滚动事件，
 * 落在**光标之下**的真实窗口上（遮罩已收起、轮廓窗点击穿透，不会截胡）。
 * 两个平台的单位不同，由各自实现消化：
 * - Windows：user32 `SendInput`，单位 = 滚轮格（WHEEL_DELTA 120）
 * - macOS：CoreGraphics `CGEventCreateScrollWheelEvent`（像素单位，平滑且与
 *   视口高度直接可比）。坐标用全局点（即 DIP），注入前无需 dipToScreen 换算
 *
 * mac 注入事件走 kCGHIDEventTap，受 TCC「辅助功能」权限管（与屏幕录制同属
 * 隐私面板，但授权立即生效、无需重启）。`prepareAutoScroll` 在启动前先查
 * 权限，未授权时返回原因字符串，控制条据此如实提示并退回手动模式。
 *
 * koffi 经动态 import 加载（可选依赖，加载失败按不可用收场，不影响手动滚动）。
 */

export interface ScrollInjector {
  /** 把光标挪到指定点（win32 传物理像素，mac 传全局 DIP 点） */
  place(point: { x: number; y: number }): void;
  /** 注入一次「向下滚动」：win32 amount = 滚轮格数；mac amount = 滚动像素（DIP） */
  stepDown(amount: number): void;
}

export type AutoScrollPrepared = { ok: true; injector: ScrollInjector } | { ok: false; reason: string };

export const MAC_INJECTION_HINT = '自动滚动需要「辅助功能」权限，已回退手动滚动';

// ---------------------------------------------------------------- Windows

/**
 * Windows 注入器。koffi 的 struct 注册是全局的，同名重复注册会冲突 ——
 * 与 mac 的动态库句柄一样做成模块级单例，进程内只准备一次。
 */
interface WinInjector {
  place(center: { x: number; y: number }): void;
  wheel(notches: number): void;
}
let winInjector: WinInjector | null = null;

async function prepareWinInjector(): Promise<ScrollInjector> {
  if (!winInjector) {
    const koffi = (await import('koffi')).default;
    const user32 = koffi.load('user32.dll');
    const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
      dx: 'long',
      dy: 'long',
      // 用带符号 long 传负的 delta（位模式与 ULONG 一致）
      mouseData: 'long',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr_t',
    });
    const INPUT = koffi.struct('INPUT', { type: 'uint32', mi: MOUSEINPUT });
    const SendInput = user32.func('uint32 __stdcall SendInput(uint32, INPUT *, int)');
    const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int, int)');
    const size = koffi.sizeof(INPUT);
    const WHEEL_DELTA = 120;
    const MOUSEEVENTF_WHEEL = 0x0800;
    winInjector = {
      place: (center) => {
        SetCursorPos(center.x, center.y);
      },
      wheel: (notches) => {
        SendInput(
          1,
          {
            type: 0,
            mi: {
              dx: 0,
              dy: 0,
              mouseData: -WHEEL_DELTA * notches,
              dwFlags: MOUSEEVENTF_WHEEL,
              time: 0,
              dwExtraInfo: 0,
            },
          },
          size,
        );
      },
    };
  }
  return {
    place: (point) => winInjector!.place(point),
    stepDown: (amount) => winInjector!.wheel(amount),
  };
}

// ------------------------------------------------------------------ macOS

/**
 * macOS 注入器。CGEvent 坐标系是全局点（DIP）；滚轮用像素单位 ——
 * 步长与视口高度直接可比（见 window.ts 的步长计算）。负值 = 向下滚，
 * 与 Windows 的负 delta 同号。
 */
interface MacContext {
  place: (point: { x: number; y: number }) => void;
  scrollPixels: (px: number) => void;
}
let macContext: MacContext | null = null;
let macTrusted: boolean | null = null;

/** 辅助功能权限查询（ApplicationServices 的 AXIsProcessTrusted，非 mac 抛错）。 */
export async function macAccessibilityTrusted(): Promise<boolean> {
  // 只缓存授权成功：未授权时每次都重查 —— 用户可能在系统设置里随时勾上，
  // TCC 辅助功能授权立即生效（不像屏幕录制要重启），缓存 false 会把人挡在外面
  if (macTrusted === true) return true;
  const koffi = (await import('koffi')).default;
  const appServices = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
  const AXIsProcessTrusted = appServices.func('bool AXIsProcessTrusted()');
  macTrusted = AXIsProcessTrusted() !== 0;
  return macTrusted;
}

async function prepareMacInjector(): Promise<ScrollInjector> {
  if (!macContext) {
    const koffi = (await import('koffi')).default;
    const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
    // 注册 CGPoint 结构：函数签名按名字引用，调用时直接传 { x, y } 字面量
    koffi.struct('CGPoint', { x: 'double', y: 'double' });
    const CGEventCreateScrollWheelEvent = cg.func(
      'void * CGEventCreateScrollWheelEvent(void *, uint32, uint32, int32)',
    );
    // kCGHIDEventTap = 0（注入到系统输入底层，与真实滚轮一致）
    const CGEventPost = cg.func('void CGEventPost(uint32, void *)');
    const CGEventCreateMouseEvent = cg.func('void * CGEventCreateMouseEvent(void *, uint32, CGPoint, uint32)');
    const CFRelease = cf.func('void CFRelease(void *)');
    const KCG_SCROLL_EVENT_UNIT_PIXEL = 0;
    const KCG_EVENT_MOUSE_MOVED = 5; // NX_MOUSEMOVED
    const KCG_EVENT_TAP_HID = 0;
    macContext = {
      place: (point) => {
        // 先真实挪光标再滚：滚轮事件落在光标之下的窗口
        const move = CGEventCreateMouseEvent(null, KCG_EVENT_MOUSE_MOVED, { x: point.x, y: point.y }, 0);
        if (move) {
          CGEventPost(KCG_EVENT_TAP_HID, move);
          CFRelease(move);
        }
      },
      scrollPixels: (px) => {
        const ev = CGEventCreateScrollWheelEvent(null, KCG_SCROLL_EVENT_UNIT_PIXEL, 1, -px);
        if (ev) {
          CGEventPost(KCG_EVENT_TAP_HID, ev);
          CFRelease(ev);
        }
      },
    };
  }
  return {
    place: (point) => macContext!.place(point),
    stepDown: (amount) => macContext!.scrollPixels(Math.max(1, Math.round(amount))),
  };
}

// ------------------------------------------------------------------ 出口

/**
 * 准备当前平台的注入器。返回 ok:false 时 reason 是给用户看的中文原因
 * （mac 辅助功能未授权 / koffi 加载失败），控制条据此提示并保持手动模式。
 */
export async function prepareAutoScroll(): Promise<AutoScrollPrepared> {
  try {
    if (process.platform === 'win32') {
      return { ok: true, injector: await prepareWinInjector() };
    }
    if (process.platform === 'darwin') {
      if (!(await macAccessibilityTrusted())) return { ok: false, reason: MAC_INJECTION_HINT };
      return { ok: true, injector: await prepareMacInjector() };
    }
    return { ok: false, reason: '当前平台不支持自动滚动' };
  } catch {
    // koffi 缺失 / 动态库加载失败：自动滚动不可用，手动模式不受影响
    return { ok: false, reason: '自动滚动不可用，已回退手动模式' };
  }
}
