import type { BrowserWindow } from 'electron';

/** 宿主可注入的日志器；缺省直接用 console。 */
export interface SnipLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

let logger: SnipLogger = console;

export function setLogger(next: SnipLogger): void {
  logger = next;
}

export const log = {
  info: (...args: unknown[]): void => logger.log(...args),
  warn: (...args: unknown[]): void => logger.warn(...args),
  error: (...args: unknown[]): void => logger.error(...args),
};

/**
 * 把渲染进程的 console / 加载失败转发到主进程日志。
 *
 * 遮罩和钉图窗口没有 DevTools，出问题只能靠这里定位。
 */
export function forwardRendererLogs(win: BrowserWindow, tag: string): void {
  win.webContents.on('console-message', (details) => {
    const { level, message, lineNumber, sourceId } = details;
    if (level === 'debug') return;
    log.info(`[${tag}:${level}] ${message} (${sourceId}:${lineNumber})`);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(`[${tag}] 页面加载失败 ${errorCode} ${errorDescription} ${validatedURL}`);
  });
}
