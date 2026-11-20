/**
 * IPC 通道名的唯一来源 —— 任何地方都不允许写字符串字面量。
 *
 * 全部带 `snip:` 前缀，避免与宿主应用自己的通道冲突。
 *
 * `boot` / `pinBoot` 用 invoke 而不是 send，是为了避免「主进程先 send、渲染进程还没订阅」的竞态。
 * `tool` / `action` / `shapes` / `draft` / `editState` 是**遮罩阶段的标注**用的：
 * 选区下方浮条选工具、点动作、回传本屏标注与拖画草稿、告知文字输入框开合；
 * `remoteShapes` / `remoteDraft` 把一块屏的标注实时投影到其余屏（跨屏画图）。
 */
export const CH = {
  overlayBoot: 'snip:overlay:boot',
  overlaySelection: 'snip:overlay:selection',
  overlayTeardown: 'snip:overlay:teardown',
  overlayReady: 'snip:overlay:ready',
  overlayInput: 'snip:overlay:input',
  /** 遮罩选了哪个标注工具（主进程广播给其余遮罩，跨屏画图要一致） */
  overlayTool: 'snip:overlay:tool',
  /** 遮罩工具条的动作：内置（钉住 / 取消 / 复制 / 保存）或宿主注册的动作 id */
  overlayAction: 'snip:overlay:action',
  /** 主 -> 遮罩：把合成数据推给宿主遮罩，就地拼图导出（复制 / 保存） */
  overlayCompose: 'snip:overlay:compose',
  /** 遮罩 -> 主：合成好的 PNG，交给主进程进剪贴板 / 存盘 */
  overlayExport: 'snip:overlay:export',
  /** 光标所在屏的遮罩请求前台 —— 保证键盘事件归正确的窗口 */
  overlayFocus: 'snip:overlay:focus',
  /** 写入剪贴板文本（放大镜复制颜色值） */
  overlayCopyText: 'snip:overlay:copyText',
  /** 遮罩把本屏标注（本屏 DIP）回传给主进程，确认时统一换算 */
  overlayShapes: 'snip:overlay:shapes',
  /** 遮罩 -> 主：本屏正在拖画的草稿（本屏 DIP），主进程换算后广播给其余遮罩 */
  overlayDraft: 'snip:overlay:draft',
  /** 遮罩 -> 主：本屏正在拖动 / 缩放的标注下标（null = 结束），广播时滤掉 */
  overlayInFlight: 'snip:overlay:inFlight',
  /** 主 -> 遮罩：其余屏已提交的标注（虚拟屏 DIP） */
  overlayRemoteShapes: 'snip:overlay:remoteShapes',
  /** 主 -> 遮罩：其余屏正在拖画的草稿（虚拟屏 DIP；null = 草稿结束） */
  overlayRemoteDraft: 'snip:overlay:remoteDraft',
  /** 文字输入框开合 —— 打字时主进程别把 Enter/Esc 吃掉 */
  overlayEditState: 'snip:overlay:editState',
  /** 主 -> 遮罩：通用结果面板（宿主动作的 loading / 结果 / 错误） */
  overlayPanel: 'snip:overlay:panel',

  /** 长图：主 -> 控制条 单帧画面 */
  scrollFrame: 'snip:scroll:frame',
  /** 长图：控制条 -> 主 动作（开始 / 滚动 / 收场 / 导出） */
  scrollAction: 'snip:scroll:action',
  /** 长图：控制条 -> 主 -> 小地图 快照 */
  scrollMinimap: 'snip:scroll:minimap',

  pinBoot: 'snip:pin:boot',
  pinReady: 'snip:pin:ready',
  pinAction: 'snip:pin:action',
} as const;
