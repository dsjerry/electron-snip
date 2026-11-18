// 标注引擎的公开入口：供宿主的非截图页面（如录制控制条）复用同一套编辑器与工具条。
export { Editor } from './editor';
export type { EditorOptions } from './editor';
export { drawShape } from './shapes';
export { createToolbar } from './toolbar';
export { toolUsesWidth } from './tools';
export type { ToolbarAction, ToolbarHandles, ToolbarOptions } from './toolbar';
