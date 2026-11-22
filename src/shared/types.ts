import type { PinPadding } from './pin-layout';

/** 与方向无关的点，单位一律是虚拟屏 DIP（可为负）。 */
export interface Point {
  x: number;
  y: number;
}

/** 矩形，单位一律是虚拟屏 DIP（可为负）。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 一块显示器的截图。
 *
 * `scaleX/scaleY` 是「每 DIP 对应多少物理像素」，从 `thumbnail.getSize()`
 * 回读得到 —— Electron 文档明确 thumbnailSize 不保证被遵守，
 * 所以绝不能直接用 `display.scaleFactor`。
 */
export interface DisplayShot {
  displayId: number;
  bounds: Rect;
  scaleX: number;
  scaleY: number;
  imageWidth: number;
  imageHeight: number;
  /**
   * 屏幕原始位图（RGBA，imageWidth × imageHeight × 4 字节）。
   * 不用 PNG：整屏 PNG 的同步编码 + 渲染端解码要几百毫秒，
   * 原始位图 IPC 直传（structured clone 一次 memcpy）然后直接进 ImageData。
   */
  pixels: Uint8Array;
}

export type ToolId = 'hand' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'pen' | 'marker' | 'mosaic' | 'counter' | 'text';

export interface StrokeBase {
  color: string;
  width: number;
}

/**
 * 所有标注坐标都在**图像像素空间**（画布 backing store 的像素），
 * 与窗口 DIP / devicePixelRatio 无关，因此拖动窗口不会让标注错位。
 */
/** 箭头样式：实心（整支填充）/ 空心（整支描边，杆身与头部同为空心） */
export type ArrowHead = 'solid' | 'open';

/** 马赛克绘制形式：选区（拖矩形）/ 涂抹（沿路径的笔刷圆斑）/ 高斯模糊 */
export type MosaicMode = 'region' | 'brush' | 'blur';

export type Shape =
  | ({ type: 'arrow' } & StrokeBase & {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        head: ArrowHead;
      })
  | ({ type: 'line' } & StrokeBase & {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      })
  | ({ type: 'rect' } & StrokeBase & { x: number; y: number; w: number; h: number })
  | ({ type: 'ellipse' } & StrokeBase & { x: number; y: number; w: number; h: number })
  | ({ type: 'pen' } & StrokeBase & { points: Point[] })
  | ({ type: 'mosaic' } & (
      | { mode: 'region'; x: number; y: number; w: number; h: number }
      | { mode: 'brush'; points: Point[]; radius: number }
      | { mode: 'blur'; x: number; y: number; w: number; h: number }
    ))
  | { type: 'counter'; x: number; y: number; n: number; color: string }
  | {
      type: 'text';
      x: number;
      y: number;
      text: string;
      color: string;
      size: number;
      /** 自动换行宽度（与绘制同一坐标系）；缺省只按 \n 分行 */
      maxWidth?: number;
    };

/**
 * 截图会话阶段。
 *
 * - `selecting`：正在框选（或尚未框选），不画手柄
 * - `adjusting`：松手后，8 向手柄 + 浮动工具条，选区可实时调整；
 *   `Enter` / 双击 = 复制，点「钉住」才进 `confirming`
 * - `confirming`：已确认钉住，等钉图就绪
 */
export type SnipPhase = 'selecting' | 'adjusting' | 'confirming';

/** 宿主动作在工具条上的描述（不含 run，run 留在主进程） */
export interface OverlayActionDescriptor {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  primary?: boolean;
}

export interface OverlayInitPayload {
  shot: DisplayShot;
  virtualBounds: Rect;
  /** 宿主注册的动作，遮罩据此把它们追加到工具条的动作组 */
  actions: OverlayActionDescriptor[];
}

export interface OverlaySelectionPayload {
  /** 虚拟屏 DIP；null 表示尚未产生选区 */
  selection: Rect | null;
  /** 当前光标位置，虚拟屏 DIP */
  cursor: Point;
  /** 当前选区按此比例换算成输出像素 */
  outScale: number;
  /** 只有 adjusting 才画手柄 */
  phase: SnipPhase;
  /** 工具条挂在哪块屏上（选区中心所在屏）；不在本屏就不渲染工具条 */
  toolbarDisplayId: number | null;
  /** 当前标注工具，其余遮罩据此决定「画标注」还是「调整选区」 */
  activeTool: ToolId;
  /**
   * 光标下的应用窗口（虚拟屏 DIP）。仅在 selecting 且尚无选区时非空：
   * 遮罩据此画高亮框（主流截图工具的窗口捕获），此时按下鼠标即采纳为选区。
   */
  hoverRect: Rect | null;
}

/** 遮罩工具条的内置动作；宿主注册的动作以其 id 调用，不在此列。 */

export interface OverlayComposePayload {
  shots: DisplayShot[];
  selection: Rect;
  outScale: number;
  /** 全部标注，**已换算成图像像素**（各屏合并后的坐标） */
  shapes: Shape[];
}

export type OverlayInput =
  | { kind: 'down' }
  | { kind: 'up' }
  | { kind: 'dblclick' }
  | { kind: 'enter' }
  | { kind: 'escape' }
  | { kind: 'context' }
  /** 方向键微调选区（adjusting 阶段）：渲染端给的 DIP 增量，主进程钳制碰撞 */
  | { kind: 'nudge'; dx: number; dy: number }
  /** Tab 轮换光标下的重叠窗口（窗口捕获阶段） */
  | { kind: 'cycle-window' };

export interface OverlayTeardownPayload {
  reason: 'confirm' | 'cancel';
}

/**
 * 主进程广播给**其余遮罩**的跨屏标注（来源屏已提交的全部标注）。
 * 坐标已换算成虚拟屏 DIP —— 接收方减去自己那块屏的原点就是本窗口局部坐标。
 */
export interface OverlayRemoteShapesPayload {
  /** 来源屏的 displayId，接收方据此过滤自己 */
  fromDisplayId: number;
  shapes: Shape[];
}

/** 其余遮罩正在拖画的草稿（虚拟屏 DIP）；`draft` 为 null 表示草稿已结束。 */
export interface OverlayRemoteDraftPayload {
  fromDisplayId: number;
  draft: Shape | null;
}

/** 通用结果面板的状态（宿主动作在遮罩里展示进度与结果） */
export interface OverlayPanelPayload {
  state: 'loading' | 'ok' | 'error';
  text?: string;
  error?: string;
}

export interface PinInitPayload {
  kind: 'snip';
  shots: DisplayShot[];
  selection: Rect;
  outScale: number;
  dipWidth: number;
  dipHeight: number;
  /** 窗口四边的阴影留白（DIP）：渲染进程据此让开画布位置，好让阴影露出来 */
  padding: PinPadding;
  /**
   * 遮罩阶段画的标注，**已换算成图像像素**（各屏本屏 DIP → 选区坐标 × outScale）。
   * 钉图 seed 进编辑器后继续可编辑。
   */
  initialShapes: Shape[];
}

/** 独立图片的贴图（历史记录、长图二次编辑等宿主场景） */
export interface PinImagePayload {
  kind: 'image';
  png: Uint8Array;
  width: number;
  height: number;
  /** 打开后直接进入标注编辑模式 */
  editMode: boolean;
}

export type PinBootPayload = PinInitPayload | PinImagePayload;

export type PinAction =
  | { kind: 'copy'; png: Uint8Array }
  | { kind: 'save'; png: Uint8Array; suggestedName: string }
  | { kind: 'close' }
  /** 滚轮缩放：窗口尺寸 × factor，光标下的点保持不动 */
  | { kind: 'zoom'; factor: number }
  /** Ctrl+滚轮 调整贴图不透明度（±delta） */
  | { kind: 'opacity'; delta: number }
  /** Ctrl+T 切换鼠标点击穿透 */
  | { kind: 'ignore' };

export interface PinActionResult {
  ok: boolean;
  error?: string;
}

/** 默认保存格式（与保存框的扩展名一致） */
export type SaveFormat = 'png' | 'jpg';

/** 长图单帧：已按选区裁好的原始 RGBA 条带 */
export interface ScrollFramePayload {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/** 长图自动滚动速度 */
export type ScrollSpeed = 'slow' | 'normal' | 'fast';

/**
 * 长图控制条的动作：
 * - `start` 用户确认开始，开始抓帧；`auto` / `manual` 切换滚动方式；`speed` 切换速度
 * - `bottom` 自动模式下渲染端判定已到底，主进程停止注入
 * - `edit` / `copy` / `save` 随带拼接完成的 PNG 结束；`cancel` 收场
 */
export interface ScrollActionPayload {
  kind: 'copy' | 'save' | 'cancel' | 'start' | 'auto' | 'manual' | 'bottom' | 'edit' | 'speed';
  png?: Uint8Array;
  speed?: ScrollSpeed;
}

/** 长图动作的回执：失败时 error 是可直接展示给用户的中文原因 */
export interface ScrollActionResult {
  ok: boolean;
  error?: string;
}

/** 小地图快照：控制条合成的缩略图与当前视口框（缩略图像素行号） */
export interface ScrollMinimapPayload {
  png: Uint8Array;
  viewTop: number;
  viewHeight: number;
}

/** 录制输出格式：GIF 动图、H.264 MP4 视频，或每帧一张 PNG（由宿主决定如何落盘） */
export type RecordFormat = 'gif' | 'mp4' | 'png-sequence';

/** 控制条动作：暂停 / 继续 / 停止（导出）/ 取消（丢弃） */
export interface RecordActionPayload {
  kind: 'pause' | 'resume' | 'stop' | 'cancel';
}

/** 控制条启动参数：主进程在 ready 时下发 */
export interface RecordBootPayload {
  format: RecordFormat;
  width: number;
  height: number;
  fps: number;
  /** 帧内存预算（字节）：渲染进程存帧超过它即请求停止，避免长时间录制吃光内存 */
  maxBytes: number;
}

/** 主进程 -> 控制条：一帧画面（RGBA，已按选区裁剪） */
export interface RecordFramePayload {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** 录制起点起算的毫秒（已扣除暂停） */
  at: number;
}

/** 主进程 -> 控制条：状态刷新（时间、阶段） */
export interface RecordStatusPayload {
  phase: 'recording' | 'paused' | 'stopping';
  elapsedMs: number;
  frames: number;
}

/** 主进程 -> 控制条：开始编码（endAt 为录制结束时刻，用于最后一帧的显示时长） */
export interface RecordEncodePayload {
  endAt: number;
}

/** 控制条 -> 主进程：编码完成的结果，或失败原因 */
export type RecordDonePayload =
  | {
      ok: true;
      format: RecordFormat;
      width: number;
      height: number;
      frames: number;
      durationMs: number;
      gif?: Uint8Array;
      /** mp4：完整 MP4 文件字节（H.264 视频，faststart：moov 在前，可直接流式播放） */
      mp4?: Uint8Array;
      /** png-sequence：按时间顺序的 PNG 字节；delays[i] 为第 i 张的显示时长（毫秒） */
      pngs?: Uint8Array[];
      delays?: number[];
    }
  | { ok: false; error: string };
