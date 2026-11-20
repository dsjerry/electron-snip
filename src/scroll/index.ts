// 长图（子路径 electron-snip/scroll）：单屏滚动截图的主进程部分。
// 渲染页面（控制条 / 小地图）随包发布在 renderer/scroll.html。
import type { IpcMain } from 'electron';
import { CH } from '../shared/channels';
import type { ScrollActionPayload, ScrollMinimapPayload } from '../shared/types';
import { handleScrollAction, onScrollMinimap } from './window';

export { beginScrollCapture, cropShot, isScrolling, startScrollCapture, stopScrollCapture } from './window';
export type { ScrollConfig, ScrollFinish } from './window';
import type { ScrollFinish } from './window';

export interface ScrollHooks {
  /** 用户选择复制 / 保存 / 编辑：拼好的长图交给宿主决定去向 */
  onFinish(finish: ScrollFinish): void | Promise<void>;
  /** 收场（取消或空结果），宿主可在这里恢复自己的窗口 */
  onCancel(reason: string): void;
}

/** 注册长图的两条 IPC 通道，返回卸载函数。 */
export function installScroll(ipcMain: IpcMain, hooks: ScrollHooks): () => void {
  ipcMain.handle(CH.scrollAction, (e, payload: ScrollActionPayload) => handleScrollAction(e.sender, payload, hooks));
  ipcMain.handle(CH.scrollMinimap, (e, payload: ScrollMinimapPayload) => onScrollMinimap(e.sender, payload));
  return () => {
    ipcMain.removeHandler(CH.scrollAction);
    ipcMain.removeHandler(CH.scrollMinimap);
  };
}
