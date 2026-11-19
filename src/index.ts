export { createSnipper } from './main/snipper';
export type { Snipper, SnipOptions, SnipAction, SnipActionContext, SnipExportEvent } from './types';
export type { SnipLogger } from './main/log';
export { ensureScreenCaptureAccess } from './main/permission';
export type { DisplayShot, Point, Rect, SnipPhase } from './shared/types';
export { captureDisplays } from './main/capture';
