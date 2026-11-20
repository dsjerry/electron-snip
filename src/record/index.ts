// 录制（子路径 electron-snip/record）：单屏录制，输出 GIF 或 PNG 序列。
// 控制条页面随包发布在 renderer/record.html；动作与帧全部经 preload 的 window.snip.record 通信。
import type { IpcMain } from 'electron';
import { CH } from '../shared/channels';
import type { RecordActionPayload, RecordDonePayload } from '../shared/types';
import { bootRecording, finishRecording, handleRecordAction } from './window';

export { cancelRecording, isRecording, startRecording } from './window';
export type { RecordConfig, RecordFinish, RecordHooks, RecordOptions } from './window';
export { buildGif, type StoredFrame } from './pipeline';

/** 注册录制的四条 IPC 通道，返回卸载函数。 */
export function installRecord(ipcMain: IpcMain): () => void {
  ipcMain.handle(CH.recordBoot, (e) => bootRecording(e.sender));
  ipcMain.handle(CH.recordAction, (e, payload: RecordActionPayload) => handleRecordAction(e.sender, payload));
  ipcMain.handle(CH.recordDone, (e, payload: RecordDonePayload) => finishRecording(e.sender, payload));
  return () => {
    ipcMain.removeHandler(CH.recordBoot);
    ipcMain.removeHandler(CH.recordAction);
    ipcMain.removeHandler(CH.recordDone);
  };
}
