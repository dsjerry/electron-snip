import type { IpcMain, WebContents } from 'electron';
import { CH } from '../shared/channels';
import type {
  OverlayInitPayload,
  OverlayInput,
  PinActionResult,
  PinAction,
  PinInitPayload,
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
  pinBoot(sender: WebContents): PinInitPayload | null;
  pinReady(sender: WebContents): void;
  pinAction(sender: WebContents, payload: PinAction): Promise<PinActionResult>;
}

/** 把 SDK 的 IPC 通道注册到 ipcMain，返回卸载函数。 */
export function installIpc(target: IpcMain, h: SnipHandlers): () => void {
  target.handle(CH.overlayBoot, (e) => h.overlayBoot(e.sender));
  target.handle(CH.overlayReady, (e) => h.overlayReady(e.sender));
  target.handle(CH.overlayInput, (e, payload: OverlayInput) => h.overlayInput(e.sender, payload));
  target.handle(CH.overlayTool, (e, payload: { tool: ToolId }) => h.overlayTool(e.sender, payload.tool));
  target.handle(CH.overlayAction, (e, payload: { id: string }) => h.overlayAction(e.sender, payload.id));
  target.handle(CH.overlayShapes, (e, payload: { shapes: Shape[] }) => h.overlayShapes(e.sender, payload.shapes));
  target.handle(CH.overlayDraft, (e, payload: { draft: Shape | null }) => h.overlayDraft(e.sender, payload.draft));
  target.handle(CH.overlayInFlight, (e, payload: { index: number | null }) =>
    h.overlayInFlight(e.sender, payload.index),
  );
  target.handle(CH.overlayEditState, (e, payload: { textEditing: boolean }) =>
    h.overlayEditState(e.sender, payload.textEditing),
  );
  target.handle(CH.overlayFocus, (e) => h.overlayFocus(e.sender));
  target.handle(CH.overlayCopyText, (_e, payload: { text: string }) => h.overlayCopyText(payload.text));
  target.handle(CH.overlayExport, (e, payload: { kind: 'copy' | 'save'; png: Uint8Array }) =>
    h.overlayExport(e.sender, payload.kind, payload.png),
  );
  target.handle(CH.pinBoot, (e) => h.pinBoot(e.sender));
  target.handle(CH.pinReady, (e) => h.pinReady(e.sender));
  target.handle(CH.pinAction, (e, payload: PinAction) => h.pinAction(e.sender, payload));
  return () => {
    for (const ch of Object.values(CH)) target.removeHandler(ch);
  };
}
