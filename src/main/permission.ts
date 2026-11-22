import { app, desktopCapturer, dialog, shell, systemPreferences } from 'electron';
import { log } from './log';

/** 「系统设置 → 隐私与安全性 → 屏幕录制」的直达链接，旧版系统也能落到对应面板。 */
const SCREEN_CAPTURE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
/** 「辅助功能」面板直达链接（长图自动滚动注入滚轮事件需要它）。 */
const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

const RESTART_LABEL = '我已授权，重启应用';
const SETTINGS_LABEL = '打开系统设置';
const LATER_LABEL = '暂不';

/** 引导弹窗一次只开一个：启动提示还没关、用户又按了快捷键时别叠两层。 */
let prompting = false;
/** 本进程是否已发起过抓屏探测：原生授权框只会弹一次，之后重复探测没有意义。 */
let probed = false;
/**
 * 本进程是否已经把用户引导到系统设置。授权结果在进程内读不到（CGPreflight 会缓存），
 * 引导之后再遇到未授权，弹窗里就提供「重启应用」，而不是让用户自己找。
 */
let guided = false;

/**
 * macOS 10.15+ 抓屏受 TCC「屏幕录制」权限管，缺失时 `desktopCapturer`
 * 只能截到桌面壁纸。macOS 没有编程式申请 API，原生弹窗也只在首次真正
 * 抓屏时出现一次，被拒过就再也不会弹 —— 只能去系统设置手动勾选。
 * 未授权时弹引导框并直达设置页；非 macOS 恒放行。
 *
 * 注意：授权结果在本进程内读不到（系统会缓存），在系统设置里勾选后必须重启应用才生效。
 *
 * @returns 是否可以直接抓屏。
 */
export async function ensureScreenCaptureAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('screen');
  log.info(`[permission] 屏幕录制权限状态：${status}`);
  if (status === 'granted') {
    return true;
  }
  // 发起一次真实抓屏请求：状态是「从未询问」时 macOS 会弹**原生**授权框，
  // 并把当前二进制自动登记进授权列表 —— 用户点「打开系统设置」开开关即可，
  // 免去手动 + 添加（选错 Electron 副本授权就粘不住）。已拒绝时此调用无害，
  // 返回的壁纸占位图直接丢弃，随后仍走手动引导。只在本进程第一次未授权时做。
  if (!probed) {
    probed = true;
    await desktopCapturer
      .getSources({ types: ['screen'] })
      .catch((err: unknown) => log.warn('[permission] 抓屏探测失败', err));
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') {
      log.info('[permission] 授权后状态已变为 granted');
      return true;
    }
  }
  await promptScreenPermission();
  return false;
}

/**
 * macOS 自动滚动注入 CGEvent 滚轮事件，受 TCC「辅助功能」权限管（与屏幕
 * 录制同一面板，但**授权立即生效、无需重启**）。未授权时弹引导框直达设置页。
 * 非 macOS 恒放行。
 */
export async function ensureAccessibilityAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const { macAccessibilityTrusted } = await import('../scroll/injector');
  if (await macAccessibilityTrusted()) return true;
  await promptAccessibilityPermission();
  // 用户可能已经勾上（引导框期间或之后）：授权立即生效，重查一次
  return macAccessibilityTrusted();
}

async function promptAccessibilityPermission(): Promise<void> {
  if (prompting) return;
  prompting = true;
  try {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: '自动滚动需要「辅助功能」权限',
      detail:
        'macOS 要求授权后才能替你滚动窗口（注入滚轮事件）。\n\n' +
        '请在「隐私与安全性 → 辅助功能」中勾选本应用，授权立即生效。\n' +
        '若是从终端启动的开发实例，需要勾选的是启动它的终端应用（如 Warp / iTerm2 / Terminal）。',
      buttons: [SETTINGS_LABEL, LATER_LABEL],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      await shell
        .openExternal(ACCESSIBILITY_SETTINGS_URL)
        .catch((err: unknown) => log.warn('[permission] 打开设置失败', err));
    }
  } finally {
    prompting = false;
  }
}

async function promptScreenPermission(): Promise<void> {
  if (prompting) return;
  prompting = true;
  try {
    const buttons = guided ? [RESTART_LABEL, SETTINGS_LABEL, LATER_LABEL] : [SETTINGS_LABEL, LATER_LABEL];
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: '截图需要「屏幕录制」权限',
      detail: guided
        ? '若已在「隐私与安全性 → 录屏与系统录音」中勾选本应用，请重启应用使其生效。\n\n' +
          '若尚未勾选，请先打开系统设置完成勾选。'
        : 'macOS 要求单独授权才能捕捉屏幕内容，未授权时只能截到桌面壁纸。\n\n' +
          '请在「隐私与安全性 → 录屏与系统录音」中勾选本应用，然后重启应用生效。\n' +
          '若是从终端启动的开发实例，macOS 会把权限归属到终端本身 —— ' +
          '需要勾选的是启动它的终端应用（如 Warp / iTerm2 / Terminal）。',
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    });
    const picked = buttons[response];
    if (picked === RESTART_LABEL) {
      log.info('[permission] 用户选择重启应用以生效授权');
      app.relaunch();
      app.exit(0);
      return;
    }
    if (picked === SETTINGS_LABEL) {
      guided = true;
      await shell.openExternal(SCREEN_CAPTURE_SETTINGS_URL);
    }
  } finally {
    prompting = false;
  }
}
