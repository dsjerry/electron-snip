import { contextBridge, ipcRenderer } from 'electron';
import { CH } from '../shared/channels';
import type { SnipRendererApi } from '../shared/api';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: SnipRendererApi = {
  overlay: {
    boot: () => ipcRenderer.invoke(CH.overlayBoot),
    selection: (cb) => on(CH.overlaySelection, cb),
    teardown: (cb) => on(CH.overlayTeardown, cb),
    ready: () => ipcRenderer.invoke(CH.overlayReady),
    input: (payload) => ipcRenderer.invoke(CH.overlayInput, payload),
    tool: (payload) => ipcRenderer.invoke(CH.overlayTool, payload),
    action: (payload) => ipcRenderer.invoke(CH.overlayAction, payload),
    shapes: (payload) => ipcRenderer.invoke(CH.overlayShapes, payload),
    draft: (payload) => ipcRenderer.invoke(CH.overlayDraft, payload),
    inFlight: (payload) => ipcRenderer.invoke(CH.overlayInFlight, payload),
    remoteShapes: (cb) => on(CH.overlayRemoteShapes, cb),
    remoteDraft: (cb) => on(CH.overlayRemoteDraft, cb),
    editState: (payload) => ipcRenderer.invoke(CH.overlayEditState, payload),
    focus: () => ipcRenderer.invoke(CH.overlayFocus),
    copyText: (payload) => ipcRenderer.invoke(CH.overlayCopyText, payload),
    compose: (cb) => on(CH.overlayCompose, cb),
    export: (payload) => ipcRenderer.invoke(CH.overlayExport, payload),
    panel: (cb) => on(CH.overlayPanel, cb),
  },
  record: {
    boot: () => ipcRenderer.invoke(CH.recordBoot),
    action: (payload) => ipcRenderer.invoke(CH.recordAction, payload),
    frame: (cb) => on(CH.recordFrame, cb),
    status: (cb) => on(CH.recordStatus, cb),
    encode: (cb) => on(CH.recordEncode, cb),
    done: (payload) => ipcRenderer.invoke(CH.recordDone, payload),
  },
  scroll: {
    frame: (cb) => on(CH.scrollFrame, cb),
    action: (payload) => ipcRenderer.invoke(CH.scrollAction, payload),
    minimap: (payload) => ipcRenderer.invoke(CH.scrollMinimap, payload),
    minimapData: (cb) => on(CH.scrollMinimap, cb),
  },
  pin: {
    boot: () => ipcRenderer.invoke(CH.pinBoot),
    ready: (payload) => ipcRenderer.invoke(CH.pinReady, payload),
    action: (payload) => ipcRenderer.invoke(CH.pinAction, payload),
  },
};

contextBridge.exposeInMainWorld('snip', api);
