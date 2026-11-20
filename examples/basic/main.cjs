// 最小示例：全局快捷键截图 → 宿主动作 → 复制 / 保存
// 运行：npm run example（在仓库根目录执行，需要本机有显示器）
const { app, clipboard, globalShortcut, ipcMain, nativeImage } = require('electron');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { createSnipper, ensureScreenCaptureAccess } = require('electron-snip');

app.whenReady().then(async () => {
  // 启动即检查屏幕录制权限（仅 macOS）：未授权时弹出引导，而不是等到第一次截图才弹
  if (!(await ensureScreenCaptureAccess())) console.log('请先授权屏幕录制权限，授权后重启应用');

  const snipper = createSnipper({
    preloadPath: require.resolve('electron-snip/preload'),
    rendererDir: path.dirname(require.resolve('electron-snip/renderer/overlay.html')),

    // 宿主动作：出现在工具条上，ctx 提供选区、截图数据与结果面板
    actions: [
      {
        id: 'size',
        label: '选区尺寸',
        run(ctx) {
          const { width, height } = ctx.selection;
          ctx.showResult({ state: 'ok', text: `${Math.round(width)} × ${Math.round(height)} DIP` });
        },
      },
    ],

    // 复制 / 保存由宿主决定；返回 false 表示用户取消
    async onExport({ kind, png }) {
      if (kind === 'copy') {
        clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)));
        return;
      }
      const file = path.join(app.getPath('desktop'), `snip-${Date.now()}.png`);
      writeFileSync(file, Buffer.from(png));
      console.log(`已保存：${file}`);
    },

    onStateChange: (snipping) => console.log(snipping ? '开始截图' : '结束截图'),
  });

  snipper.install(ipcMain);
  globalShortcut.register('CommandOrControl+Shift+A', () => void snipper.start());
  console.log('按 Ctrl/Cmd+Shift+A 开始截图，Esc 取消');
});

// 没有窗口时保持运行（托盘类应用的常见做法）
app.on('window-all-closed', () => {});
app.on('will-quit', () => globalShortcut.unregisterAll());
