# Changelog

## Unreleased

- 录制新增 MP4 输出：控制条渲染进程用 WebCodecs 编 H.264，配零依赖的手写 MP4 封装器（faststart）；编码器以 `buildMp4` 从浏览器可用的 `electron-snip/record/mp4` 导出，供宿主自绘控制条复用。
- 新增 `Snipper.pick(options)`：框选后不进工具条，确认选区直接移交宿主；配套 `release()` 结束移交。
- 新增子路径：`electron-snip/ocr`（系统 OCR）、`electron-snip/scroll`（长图）、`electron-snip/record`（录制 GIF / PNG 序列）、`electron-snip/utils`、`electron-snip/annotations`。
- 修复长图：自动滚动在注入器加载期间被取消时可能访问已清空的状态，并残留定时器阻断之后的自动滚动；注入器加载失败改为记录日志而非抛错。
- 修复录制：最长时长按录制时间（扣除暂停）计算，不再按墙上时钟提前截断；会话收场按会话身份判断，避免异步回调误杀下一次录制。
- 录制编码器只依赖 `Uint8Array`，可在渲染进程运行。
- 主进程模块统一使用可注入的日志器，不再直接写 `console`。
- 控制条落位逻辑（长图 / 录制）合并为 `placeBar`，并补充单元测试。
- 清理未使用的类型与函数；修正注释中指向宿主文件的陈旧引用。
- 冒烟脚本消除 `console-message` 弃用警告，新增 `npm run smoke:record`。

- macOS 屏幕录制权限：原生探测每个进程只做一次；引导过用户后，未授权时弹窗提供「我已授权，重启应用」。
- 文字标注支持自动换行：文字框宽度即换行宽度，绘制与导出与输入时的折行一致；回车与 Shift+回车换行。
- 箭头样式改为图标按钮（实心 / 空心），悬停显示中文名称。
- 标注绘制支持 Shift 约束：矩形变正方形、椭圆变正圆，画笔与荧光笔变直线（松开 Shift 恢复手绘）。

## 0.1.0

首个版本，从 screenshots-demo 抽离。

- 跨屏框选（混合 DPI、负坐标虚拟屏），松手后进入调整阶段。
- 窗口吸附（`get-windows`，异步枚举，不触发额外权限框）。
- 标注引擎：箭头、直线、矩形、椭圆、画笔、荧光笔、马赛克（选区 / 涂抹 / 模糊）、序号、文字；撤销 / 重做；滚轮调线宽。
- 钉住为贴图（阴影留白、透明窗口、可缩放 / 调透明度 / 穿透）；`pinImage` 支持独立图片。
- 复制 / 保存经 `onExport` 交给宿主；未提供时使用内置剪贴板与保存框。
- 宿主动作（`actions`）与通用结果面板（loading / ok / error）。
- 导出 `ensureScreenCaptureAccess`（macOS 屏幕录制权限引导）。

Electron 兼容范围：`>=43`。
