import type { BrowserWindow, IpcMain } from 'electron';
import type { DisplayShot, OverlayPanelPayload, Rect, SaveFormat } from './shared/types';
import type { SnipLogger } from './main/log';

/** 宿主动作拿到的会话上下文 */
export interface SnipActionContext {
  /** 触发时的选区（虚拟屏 DIP） */
  readonly selection: Rect;
  readonly shots: DisplayShot[];
  /** 选区与各屏的最大交集 —— 单屏内的录制 / 长图等动作需要它 */
  pickSingleDisplay(): { shot: DisplayShot; region: Rect } | null;
  /** 收起遮罩但保持会话（宿主接管后续流程时使用） */
  hideOverlays(): void;
  /** 结束本次截图（等同于取消） */
  end(reason?: string): void;
  /** 在触发动作的遮罩里显示通用结果面板 */
  showResult(result: OverlayPanelPayload): void;
}

/** 注册到工具条的宿主动作，追加在内置动作之后。 */
export interface SnipAction {
  id: string;
  label: string;
  /** 图标（SVG 字符串）；缺省为文字按钮 */
  icon?: string;
  danger?: boolean;
  primary?: boolean;
  run(ctx: SnipActionContext): void | Promise<void>;
}

export interface SnipExportEvent {
  kind: 'copy' | 'save';
  png: Uint8Array;
  /** 截图开始时的前台应用名（拿不到则缺省），用于宿主的历史记录等 */
  sourceApp?: string;
}

export interface SnipOptions {
  /** 包的 preload 绝对路径：`require.resolve('electron-snip/preload')` */
  preloadPath: string;
  /** 包内预构建渲染资源（overlay.html / pin.html）所在目录 */
  rendererDir: string;
  /** 宿主动作，显示在工具条的动作组里 */
  actions?: SnipAction[];
  /**
   * 接管「复制 / 保存」。提供后，包不再写剪贴板或弹保存框 ——
   * 返回 `false` 表示用户取消，遮罩会收到失败结果。
   */
  onExport?(event: SnipExportEvent): boolean | void | Promise<boolean | void>;
  /** 钉住后仍需保持隐藏的宿主窗口（抓屏前被隐藏、取消时才恢复） */
  keepHiddenAfterPin?(win: BrowserWindow): boolean;
  /** 截图开始 / 结束时通知宿主（用于托盘图标等） */
  onStateChange?(snipping: boolean): void;
  /** 取消截图后把焦点还给宿主 */
  focusHost?(): void;
  /** 默认保存目录（仅在未提供 onExport 时使用） */
  saveDir?: string;
  /** 默认保存格式（仅在未提供 onExport 时使用） */
  saveFormat?: SaveFormat;
  /** 窗口吸附（悬停高亮整窗、单击采纳），默认开启 */
  windowSnap?: boolean;
  /** 日志器，缺省为 console */
  logger?: SnipLogger;
}

export interface Snipper {
  /** 开始一次截图（抓屏并显示遮罩） */
  start(): Promise<void>;
  /** 结束当前截图并恢复宿主窗口 */
  cancel(reason?: string): void;
  /** 注册 IPC 通道与屏幕事件，返回卸载函数；必须在 app ready 之后调用 */
  install(ipcMain: IpcMain): () => void;
  /** 把一张独立图片钉成贴图（历史记录、长图编辑等） */
  pinImage(png: Uint8Array, opts?: { editMode?: boolean }): Promise<void>;
  /** 结束会话并释放所有窗口 */
  dispose(): void;
}
