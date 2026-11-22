# electron-snip

[![CI](https://github.com/dsjerry/electron-snip/actions/workflows/ci.yml/badge.svg)](https://github.com/dsjerry/electron-snip/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
![Electron](https://img.shields.io/badge/Electron-%3E%3D43-47848F)
![Node](https://img.shields.io/badge/Node-24-339933)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)

Electron 跨屏截图 SDK：框选（可跨屏、混合 DPI）、窗口吸附、遮罩标注、钉成贴图、复制 / 保存。
长图、录制、系统 OCR 作为可选子路径提供，按需引入。宿主通过动作（action）与导出回调接入业务逻辑。

An Electron screenshot SDK: multi-display region selection (mixed DPI), window snapping, annotation overlay, pinned windows, copy / save. Scrolling capture, screen recording and system OCR are optional sub-paths. The host plugs in through actions and export callbacks.

## 功能状态 · Status

| 能力                                 | 状态                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| 框选、跨屏、窗口吸附、标注           | 核心功能，macOS 手动测试通过（窗口吸附坐标已在双屏环境核实）；Windows 待验证        |
| 钉成贴图、独立图片贴图（`pinImage`） | macOS 手动测试通过                                                                  |
| 系统 OCR（`electron-snip/ocr`）      | 实现覆盖 macOS（Vision）与 Windows（WinRT）；两者均待实机验证                       |
| 长图（`electron-snip/scroll`）       | 手动滚动待实机验证；Windows 自动滚动（koffi 注入）待验证                            |
| 录制（`electron-snip/record`）       | GIF / MP4 / PNG 序列，已通过真实抓屏冒烟（macOS）；**录制中标注与点击涟漪尚未提供** |

## 安装 · Install

```bash
npm install github:dsjerry/electron-snip
```

要求 Electron `>=43`（`peerDependencies`）。暂未发布到 npm，以 GitHub 依赖分发。

Requires Electron `>=43` (peer dependency). Not yet published to npm; install from GitHub.

## 快速开始 · Quick start

```ts
// 主进程
import { app, globalShortcut, ipcMain } from 'electron';
import path from 'node:path';
import { createSnipper } from 'electron-snip';

app.whenReady().then(() => {
  const snipper = createSnipper({
    preloadPath: require.resolve('electron-snip/preload'),
    rendererDir: path.dirname(require.resolve('electron-snip/renderer/overlay.html')),
    actions: [
      {
        id: 'size',
        label: '选区尺寸',
        run(ctx) {
          const { width, height } = ctx.selection;
          ctx.showResult({ state: 'ok', text: `${Math.round(width)} × ${Math.round(height)}` });
        },
      },
    ],
    // 复制 / 保存由宿主决定；返回 false 表示未完成（例如用户取消了保存）
    onExport({ kind, png }) {
      // 写剪贴板或落盘
    },
  });

  snipper.install(ipcMain);
  globalShortcut.register('CommandOrControl+Shift+A', () => void snipper.start());
});
```

完整可运行示例见 [`examples/basic`](./examples/basic)（`npm run example`）。

A complete runnable example is in [`examples/basic`](./examples/basic) (`npm run example`).

## 子路径 · Sub-paths

| 导入路径                        | 内容                                                                           | 运行环境 |
| ------------------------------- | ------------------------------------------------------------------------------ | -------- |
| `electron-snip`                 | `createSnipper`、`captureDisplays`、`ensureScreenCaptureAccess`                | 主进程   |
| `electron-snip/preload`         | 预加载脚本（`window.snip`），路径经 `require.resolve` 取得                     | preload  |
| `electron-snip/renderer/*`      | 随包发布的渲染页面（`overlay.html`、`pin.html`、`scroll.html`、`record.html`） | 文件 URL |
| `electron-snip/annotations`     | 标注编辑器、工具条、`drawShape`、`toolUsesWidth`                               | 渲染进程 |
| `electron-snip/annotations.css` | 标注与工具条样式                                                               | 渲染进程 |
| `electron-snip/utils`           | `toBlob`、`toClamped`、`pointInRect`（与 Electron 无关）                       | 两者     |
| `electron-snip/ocr`             | `recognizeImagePng(png)`，系统 OCR                                             | 主进程   |
| `electron-snip/scroll`          | 长图：`startScrollCapture`、`installScroll` 等                                 | 主进程   |
| `electron-snip/record`          | 录制：`startRecording`、`installRecord`、`buildGif` 等                         | 主进程   |
| `electron-snip/record/mp4`      | `buildMp4`：H.264 编码 + MP4 封装（WebCodecs，零依赖）                         | 渲染进程 |

## API

### `createSnipper(options): Snipper`

| 选项                       | 说明                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- |
| `preloadPath`              | 包的 preload 绝对路径，`require.resolve('electron-snip/preload')`            |
| `rendererDir`              | 包内渲染资源目录（含 `overlay.html`、`pin.html`）                            |
| `actions?`                 | 工具条上的宿主动作：`{ id, label, icon?, danger?, primary?, run(ctx) }`      |
| `onExport?`                | 接管「复制 / 保存」。提供后包不写剪贴板、不弹保存框；返回 `false` 视为未完成 |
| `onCancel?`                | 每次结束截图时回调（含宿主调用 `cancel`），用于收起宿主的附属窗口            |
| `keepHiddenAfterPin?`      | 钉住后仍需保持隐藏的宿主窗口                                                 |
| `onStateChange?`           | 截图开始 / 结束时通知宿主                                                    |
| `focusHost?`               | 取消截图后把焦点还给宿主                                                     |
| `saveDir?` / `saveFormat?` | 默认保存目录与格式（仅未提供 `onExport` 时生效）                             |
| `windowSnap?`              | 窗口吸附，默认开启                                                           |
| `logger?`                  | 日志器（`log` / `warn` / `error`），默认 `console`                           |

`ctx`（动作上下文）提供：`selection`、`shots`、`sourceApp`、`pickSingleDisplay()`（选区落在单屏时返回 `{ shot, region }`）、`hideOverlays()`、`end(reason?)`、`showResult(payload)`。

`Snipper` 方法：`start()`、`pick(options)`、`cancel(reason?)`、`release()`、`install(ipcMain)`（返回卸载函数）、`pinImage(png, { editMode? })`、`closePins()`、`setPinsMouseIgnore(ignore)`、`dispose()`。

### 框选后移交 · `pick(options)`

只框选、不进工具条：回车或双击确认后，遮罩收起，选区交给宿主（如录制、长图的入口）。

```ts
snipper.pick({
  onPick({ shot, region, sourceApp }) {
    // 宿主流程开始；结束时必须调用 snipper.release()
  },
  onCancel(reason) {
    // 框选阶段取消（Esc 等）；移交之后的取消走 createSnipper 的 onCancel
  },
});
```

- 同一时间只能有一个移交中的会话；移交期间再次 `pick` / `start` 会被忽略。
- `release()` 恢复被隐藏的窗口且不触发 `onCancel`；`cancel()` 会触发 `onCancel`。

### 长图 · `electron-snip/scroll`

```ts
import { installScroll, startScrollCapture } from 'electron-snip/scroll';

installScroll(ipcMain, {
  onFinish({ kind, png }) {
    // kind: 'copy' | 'save' | 'edit'，png 为拼接好的长图
  },
  onCancel(reason) {},
});

// 在动作里启动（先隐藏遮罩，再开始）：
// ctx.hideOverlays();
// startScrollCapture(pick.shot, pick.region, { preloadPath, rendererDir });
```

只支持单屏选区。点「长图」后需要用户点「开始」才开始抓帧。自动滚动仅 Windows 可用，依赖可选依赖 `koffi`。

### 录制 · `electron-snip/record`

```ts
import { installRecord, startRecording } from 'electron-snip/record';

installRecord(ipcMain);

// 在动作里启动：
// ctx.hideOverlays();
// startRecording(
//   { shot: pick.shot, region: pick.region, format: 'gif', config: { preloadPath, rendererDir } },
//   {
//     onFinish(r) { /* r.gif / r.mp4（完整字节），或 r.pngs + r.delays（PNG 序列） */ },
//     onCancel(reason) {},
//   },
// );
```

- `format: 'gif' | 'mp4' | 'png-sequence'`。MP4 由控制条渲染进程的 WebCodecs 编出 H.264
  （内置零依赖封装器，moov 在前可直接流式播放），环境没有可用编码器时按失败收场、不留半成品。
- 帧率默认 10fps，最长 5 分钟（按录制时间计，暂停不计入），帧内存超过 384MB 自动停止。
- 相同画面自动合并，静止时长时间录制也不会占用大量内存。
- 只支持单屏选区。`cancelRecording()`、`isRecording()` 可用于外部收场与查询。
- 自绘控制条的宿主可直接复用编码器：`import { buildMp4 } from 'electron-snip/record/mp4'`（浏览器可用）。

### OCR · `electron-snip/ocr`

```ts
import { recognizeImagePng } from 'electron-snip/ocr';

const text = await recognizeImagePng(pngBuffer); // pngBuffer: Buffer，宿主提供的选区 PNG
```

macOS 使用 Vision，Windows 使用 WinRT OCR，均为系统自带、离线运行。

### 工具函数 · `electron-snip/utils`

- `toBlob(bytes, mime)`：`Uint8Array` 转 `Blob`（复制一份，避开 `SharedArrayBuffer` 类型问题）。
- `toClamped(bytes)`：转为 `Uint8ClampedArray<ArrayBuffer>`。
- `pointInRect(rect, point)`：点是否在矩形内。

### 标注 · `electron-snip/annotations`

`Editor`、`createToolbar`、`drawShape`、`toolUsesWidth` 可在宿主自己的渲染页面里复用同一套标注编辑器与工具条。导入 `electron-snip/annotations.css` 获取样式。

### 其它导出

- `ensureScreenCaptureAccess()`：macOS 屏幕录制权限检查与引导（非 macOS 恒返回 `true`）。授权状态在进程内会被系统缓存，授权后需要重启应用。
- `captureDisplays(targets, all, silent?)`：按显示器抓屏，返回原始 RGBA 位图。

## 平台注意 · Platform notes

- **macOS**：遮罩窗口需要 `enableLargerThanScreen`，否则菜单栏区域无法框选。屏幕录制权限归属启动它的终端（开发模式）。窗口吸附用 `get-windows`（关闭了辅助功能与屏幕录制检查，不触发额外权限框）。`get-windows` 的坐标与 DIP 对齐已在双屏环境下核实。
- **Windows**：遮罩 `thickFrame: false`，避免 Aero Snap 造成几像素偏移。`get-windows` 依赖预编译二进制，安装时需允许它的 install 脚本（包内 `allowScripts` 已声明）。自动滚动依赖可选依赖 `koffi`。
- 遮罩、贴图、控制条都 `setContentProtection(true)`，不会被截进任何截图。

窗口层的不变量（抓屏时序、层级、DPI 换算）写在它们所保护的代码旁边的注释里。

Hard-won invariants (capture ordering, window levels, DPI conversions) are documented in the source comments next to the code they protect.

## 开发 · Development

```bash
npm install                 # prepare 会自动构建 dist/
npm run build               # tsup：ESM / CJS 主体、CJS preload、IIFE 渲染页面
npm run typecheck
npm run lint
npm run format:check
npm test                    # 纯逻辑（node）+ DOM / canvas（Chromium）
npm run smoke               # 用 Electron 加载遮罩与贴图产物（需要显示器）
npm run smoke:record        # 真实抓屏录制 2 秒，校验 GIF / MP4 与取消路径（需要屏幕录制权限）
npm run example             # 运行最小示例
```

浏览器测试需要 Chromium：`npx playwright install chromium`。贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 路线图与限制 · Roadmap and limitations

- 录制中的标注（录制时画箭头、框、文字，并合成到对应帧上）与点击涟漪尚未提供。
- 长图与录制只支持单屏选区。
- 尚未发布到 npm。

## 许可 · License

MIT
