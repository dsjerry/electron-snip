// 冒烟测试：加载 electron-snip 的构建产物，验证 preload / 渲染脚本 / 工具条装配
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const preload = path.join(dist, 'preload.cjs');
const result = {};

function fakeShot() {
  const w = 200;
  const h = 100;
  return {
    displayId: 1,
    bounds: { x: 0, y: 0, width: w, height: h },
    scaleX: 1,
    scaleY: 1,
    imageWidth: w,
    imageHeight: h,
    pixels: new Uint8Array(w * h * 4).fill(255),
  };
}

app.whenReady().then(async () => {
  ipcMain.handle('snip:overlay:boot', () => ({
    shot: fakeShot(),
    virtualBounds: { x: 0, y: 0, width: 200, height: 100 },
    actions: [{ id: 'ext', label: '宿主动作', icon: '<svg viewBox="0 0 24 24"></svg>' }],
  }));
  ipcMain.handle('snip:overlay:ready', () => undefined);
  ipcMain.handle('snip:pin:boot', () => ({
    shots: [fakeShot()],
    selection: { x: 0, y: 0, width: 200, height: 100 },
    outScale: 1,
    dipWidth: 200,
    dipHeight: 100,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    initialShapes: [],
  }));
  ipcMain.handle('snip:pin:ready', () => undefined);

  const webPreferences = { preload, contextIsolation: true, nodeIntegration: false, sandbox: false };

  const ov = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences });
  const ovErrors = [];
  ov.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) ovErrors.push(message);
  });
  await ov.loadFile(path.join(dist, 'renderer', 'overlay.html'));
  await new Promise((r) => setTimeout(r, 800));
  result.overlay = await ov.webContents.executeJavaScript(`({
    snipType: typeof window.snip,
    overlayApi: typeof (window.snip && window.snip.overlay && window.snip.overlay.boot),
    toolbarActions: [...document.querySelectorAll('#toolbar [data-action]')].map(b => b.dataset.action),
    hostActionPresent: !!document.querySelector('#toolbar [data-action="ext"]'),
    stageWidth: document.getElementById('stage').width,
    panelHidden: document.getElementById('result-panel').hidden,
  })`);
  result.overlayErrors = ovErrors;

  const pin = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences });
  const pinErrors = [];
  pin.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) pinErrors.push(message);
  });
  await pin.loadFile(path.join(dist, 'renderer', 'pin.html'));
  await new Promise((r) => setTimeout(r, 800));
  result.pin = await pin.webContents.executeJavaScript(`({
    snipType: typeof window.snip,
    canvasWidth: document.getElementById('stage').width,
    canvasHeight: document.getElementById('stage').height,
    closeButton: !!document.getElementById('close'),
  })`);
  result.pinErrors = pinErrors;

  console.log('SMOKE ' + JSON.stringify(result));
  app.quit();
});
