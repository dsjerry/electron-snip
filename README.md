# electron-snip

Electron 跨屏截图 SDK：框选（可跨屏、混合 DPI）、窗口吸附、遮罩标注、钉成贴图、复制 / 保存。
宿主只需注册动作与导出回调。

An Electron screenshot SDK: multi-display region selection (mixed DPI), window snapping, annotation overlay, pinned image windows, copy / save. The host registers actions and an export callback.

## 安装 · Install

```bash
npm install git+ssh://git@github.com/<owner>/electron-snip.git
```

要求 Electron `>=43`（`peerDependencies`）。发布前以 git 依赖分发。

Requires Electron `>=43` (peer dependency). Distributed via git dependency until published to npm.

## 快速开始 · Quick start

```ts
// 主进程（ESM）
import { app, ipcMain, globalShortcut } from 'electron';
import { createSnipper } from 'electron-snip';

app.whenReady().then(() => {
  const snipper = createSnipper({
    preloadPath: require.resolve('electron-snip/preload'),
    rendererDir: path.dirname(require.resolve('electron-snip/renderer/overlay.html')),
    actions: [
      {
        id: 'ocr',
        label: '提取文字',
        run: async (ctx) => {
          const pick = ctx.pickSingleDisplay();
          if (!pick) return ctx.showResult({ state: 'error', error: '选区无法落在单块屏内' });
          ctx.showResult({ state: 'loading' });
          // ...调用你的 OCR，然后：
          ctx.showResult({ state: 'ok', text: '识别结果' });
        },
      },
    ],
    onExport: async ({ kind, png, sourceApp }) => {
      // 复制 / 保存由宿主决定。返回 false 表示用户取消。
    },
  });

  snipper.install(ipcMain);
  globalShortcut.register('Ctrl+Shift+A', () => void snipper.start());
});
```

## API

### `createSnipper(options): Snipper`

| 选项                       | 说明                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| `preloadPath`              | 包的 preload 绝对路径，`require.resolve('electron-snip/preload')`           |
| `rendererDir`              | 包内渲染资源目录（含 `overlay.html` / `pin.html`）                          |
| `actions?`                 | 追加到工具条的宿主动作：`{ id, label, icon?, danger?, primary?, run(ctx) }` |
| `onExport?`                | 接管「复制 / 保存」。提供后包不写剪贴板、不弹保存框                         |
| `onCancel?`                | 每次结束截图时回调，用于收起宿主的附属窗口                                  |
| `keepHiddenAfterPin?`      | 钉住后仍需保持隐藏的宿主窗口                                                |
| `onStateChange?`           | 截图开始 / 结束时通知宿主                                                   |
| `focusHost?`               | 取消截图后把焦点还给宿主                                                    |
| `saveDir?` / `saveFormat?` | 默认保存目录与格式（仅未提供 `onExport` 时生效）                            |
| `windowSnap?`              | 窗口吸附，默认开启                                                          |
| `logger?`                  | 日志器，默认 `console`                                                      |

`Snipper` 方法：`start()`、`cancel(reason?)`、`pinImage(png, { editMode? })`、`closePins()`、`setPinsMouseIgnore(ignore)`、`install(ipcMain)`（返回卸载函数）、`dispose()`。

`ensureScreenCaptureAccess()`（macOS 屏幕录制权限引导）也从包入口导出。

## 平台注意 · Platform notes

- **macOS**：遮罩窗口需要 `enableLargerThanScreen`，否则菜单栏区域无法框选。屏幕录制权限归属启动它的终端（开发模式）。窗口吸附用 `get-windows`，关闭了辅助功能与屏幕录制检查，不触发额外权限框。
- **Windows**：遮罩 `thickFrame: false`，避免 Aero Snap 造成几像素偏移。`get-windows` 依赖预编译二进制，安装时需要允许它的 install 脚本（包内 `allowScripts` 已声明）。
- 遮罩与贴图都 `setContentProtection(true)`，不会被截进任何截图。

Hard-won invariants (capture ordering, overlay levels, DPI conversions) are documented in the source comments next to the code they protect.

## 开发 · Development

```bash
npm install
npm run build      # tsup：ESM 主体、CJS preload、IIFE 渲染页面
npm run typecheck
npm run lint
npm test           # 纯逻辑（node）+ DOM / canvas（Chromium）
npm run smoke      # 用 Electron 加载产物做冒烟检查（需要本机显示）
```

## 许可 · License

MIT
