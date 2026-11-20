import type {
  OverlayComposePayload,
  OverlayInitPayload,
  OverlayInput,
  OverlayPanelPayload,
  OverlayRemoteDraftPayload,
  OverlayRemoteShapesPayload,
  OverlaySelectionPayload,
  OverlayTeardownPayload,
  PinAction,
  PinActionResult,
  PinBootPayload,
  ScrollActionPayload,
  ScrollFramePayload,
  ScrollMinimapPayload,
  Shape,
  ToolId,
} from './types';

/** preload 暴露给渲染进程（遮罩与贴图页面）的 API，挂在 `window.snip` 上。 */
export interface SnipRendererApi {
  overlay: {
    /** 拉取本窗口对应的截图与宿主动作；会话已结束则返回 null */
    boot(): Promise<OverlayInitPayload | null>;
    selection(cb: (payload: OverlaySelectionPayload) => void): () => void;
    teardown(cb: (payload: OverlayTeardownPayload) => void): () => void;
    ready(): Promise<void>;
    input(payload: OverlayInput): Promise<void>;
    /** 换标注工具；主进程会广播给其余遮罩 */
    tool(payload: { tool: ToolId }): Promise<void>;
    /** 工具条动作：内置（copy / pin / save / cancel）或宿主注册的 id */
    action(payload: { id: string }): Promise<void>;
    /** 把本屏标注（本屏 DIP 坐标）回传，仅在历史变化时调 */
    shapes(payload: { shapes: Shape[] }): Promise<void>;
    /** 把本屏正在拖画的草稿（本屏 DIP 坐标）回传，主进程换算后投影到其余屏 */
    draft(payload: { draft: Shape | null }): Promise<void>;
    /** 本屏正在拖动 / 缩放的标注下标（null = 结束）；主进程广播时把它滤掉 */
    inFlight(payload: { index: number | null }): Promise<void>;
    /** 其余屏已提交的标注（虚拟屏 DIP），本屏只负责渲染落在本屏的部分 */
    remoteShapes(cb: (payload: OverlayRemoteShapesPayload) => void): () => void;
    /** 其余屏正在拖画的草稿（虚拟屏 DIP）；draft 为 null 表示草稿结束 */
    remoteDraft(cb: (payload: OverlayRemoteDraftPayload) => void): () => void;
    /** 文字输入框开合，主进程据此决定要不要接管 Enter / Esc */
    editState(payload: { textEditing: boolean }): Promise<void>;
    /** 把本遮罩提到前台（光标移到哪块屏，键盘事件就归哪块屏） */
    focus(): Promise<void>;
    /** 写入剪贴板文本（放大镜复制颜色值、结果面板复制文字） */
    copyText(payload: { text: string }): Promise<PinActionResult>;
    /** 主进程推合成数据，本窗口就地拼图导出 */
    compose(cb: (payload: { kind: 'copy' | 'save'; data: OverlayComposePayload }) => void): () => void;
    /** 合成好的 PNG 交回主进程（剪贴板 / 存盘） */
    export(payload: { kind: 'copy' | 'save'; png: Uint8Array }): Promise<PinActionResult>;
    /** 宿主动作的通用结果面板（loading / ok / error） */
    panel(cb: (payload: OverlayPanelPayload) => void): () => void;
  };
  scroll: {
    /** 主进程推送的单帧画面（控制条） */
    frame(cb: (payload: ScrollFramePayload) => void): () => void;
    /** 控制条动作：开始 / 滚动方式 / 速度 / 收场 / 导出 */
    action(payload: ScrollActionPayload): Promise<void>;
    /** 控制条 -> 主进程：小地图快照（经主进程转发给小地图窗口） */
    minimap(payload: ScrollMinimapPayload): Promise<void>;
    /** 小地图窗口收到的快照 */
    minimapData(cb: (payload: ScrollMinimapPayload) => void): () => void;
  };
  pin: {
    /** 拿到拼接所需的全部数据 */
    boot(): Promise<PinBootPayload | null>;
    /** 拼接完成，主进程收到后才会收起遮罩并显示贴图 */
    ready(payload: { width: number; height: number }): Promise<void>;
    action(payload: PinAction): Promise<PinActionResult>;
  };
}
