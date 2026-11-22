import type { IpcMain, WebContents } from 'electron';
import { CH } from '../shared/channels';
import type {
  OverlayInitPayload,
  OverlayInput,
  PinActionResult,
  PinAction,
  PinBootPayload,
  Shape,
  ToolId,
} from '../shared/types';

/** 会话层对外暴露的处理函数，IPC 层只做通道到函数的一一映射。 */
export interface SnipHandlers {
  overlayBoot(sender: WebContents): OverlayInitPayload | null;
  overlayReady(sender: WebContents): void;
  overlayInput(sender: WebContents, payload: OverlayInput): void;
  overlayTool(sender: WebContents, tool: ToolId): void;
  overlayAction(sender: WebContents, id: string): void;
  overlayShapes(sender: WebContents, shapes: Shape[]): void;
  overlayDraft(sender: WebContents, draft: Shape | null): void;
  overlayInFlight(sender: WebContents, index: number | null): void;
  overlayEditState(sender: WebContents, textEditing: boolean): void;
  overlayExport(sender: WebContents, kind: 'copy' | 'save', png: Uint8Array): Promise<PinActionResult>;
  overlayFocus(sender: WebContents): void;
  overlayCopyText(text: string): Promise<PinActionResult>;
  pinBoot(sender: WebContents): PinBootPayload | null;
  pinReady(sender: WebContents): void;
  pinAction(sender: WebContents, payload: PinAction): Promise<PinActionResult>;
}

/** 把 SDK 的 IPC 通道注册到 ipcMain，返回卸载函数。 */
export function installIpc(target: IpcMain, h: SnipHandlers): () => void {
  // 只摘**本函数注册**的通道：record / scroll 子路径会在同一个 ipcMain 上注册
  // 自己的通道（electron-snip/record、/scroll 是可共存的子路径导出），卸载若
  // 遍历整个 CH 表，会把兄弟模块的 handler 一起删掉，渲染端 invoke 全部静默报错
  const registered: string[] = [];
  const track = (channel: string): string => {
    registered.push(channel);
    return channel;
  };

  target.handle(track(CH.overlayBoot), (e) => h.overlayBoot(e.sender));
  target.handle(track(CH.overlayReady), (e) => h.overlayReady(e.sender));
  target.handle(track(CH.overlayInput), (e, payload: OverlayInput) => h.overlayInput(e.sender, payload));
  target.handle(track(CH.overlayTool), (e, payload: { tool: ToolId }) => h.overlayTool(e.sender, payload.tool));
  target.handle(track(CH.overlayAction), (e, payload: { id: string }) => h.overlayAction(e.sender, payload.id));
  target.handle(track(CH.overlayShapes), (e, payload: { shapes: Shape[] }) =>
    h.overlayShapes(e.sender, payload.shapes),
  );
  target.handle(track(CH.overlayDraft), (e, payload: { draft: Shape | null }) =>
    h.overlayDraft(e.sender, payload.draft),
  );
  target.handle(track(CH.overlayInFlight), (e, payload: { index: number | null }) =>
    h.overlayInFlight(e.sender, payload.index),
  );
  target.handle(track(CH.overlayEditState), (e, payload: { textEditing: boolean }) =>
    h.overlayEditState(e.sender, payload.textEditing),
  );
  target.handle(track(CH.overlayFocus), (e) => h.overlayFocus(e.sender));
  target.handle(track(CH.overlayCopyText), (_e, payload: { text: string }) => h.overlayCopyText(payload.text));
  target.handle(track(CH.overlayExport), (e, payload: { kind: 'copy' | 'save'; png: Uint8Array }) =>
    h.overlayExport(e.sender, payload.kind, payload.png),
  );
  target.handle(track(CH.pinBoot), (e) => h.pinBoot(e.sender));
  target.handle(track(CH.pinReady), (e) => h.pinReady(e.sender));
  target.handle(track(CH.pinAction), (e, payload: PinAction) => h.pinAction(e.sender, payload));
  return () => {
    for (const ch of registered) target.removeHandler(ch);
  };
}
