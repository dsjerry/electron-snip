// 冒烟测试：真实抓屏录制，检查 GIF / MP4 产物、取消路径与连续会话。
// 需要本机有显示器并已授予屏幕录制权限（macOS）。运行：npm run smoke:record
const { app, screen, ipcMain } = require('electron');
const { writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const record = require(path.join(dist, 'record', 'record.cjs'));
const { captureDisplays } = require(path.join(dist, 'index.cjs'));

const out = path.join(os.tmpdir(), 'electron-snip-smoke.gif');
const outMp4 = path.join(os.tmpdir(), 'electron-snip-smoke.mp4');
const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, detail });
const within = (promise, ms, fallback) =>
  Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);

// 与真实应用一致：托盘常驻，窗口全部关闭时不退出（否则会话之间应用会被退出，加载随之失败）
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  record.installRecord(ipcMain);
  const display = screen.getPrimaryDisplay();
  const [shot] = await captureDisplays([display], screen.getAllDisplays(), true);
  const region = { x: display.bounds.x + 100, y: display.bounds.y + 100, width: 320, height: 200 };
  const config = { preloadPath: path.join(dist, 'preload.cjs'), rendererDir: path.join(dist, 'renderer') };

  // 1) 正常录制：由时长上限自动停止，产出 GIF
  const finished = new Promise((resolve) => {
    const started = record.startRecording(
      { shot, region, format: 'gif', config, maxDurationMs: 2000 },
      { onFinish: (r) => resolve({ kind: 'finish', r }), onCancel: (reason) => resolve({ kind: 'cancel', reason }) },
    );
    ok('开始录制', started);
  });
  const first = await within(finished, 30000, { kind: 'timeout' });
  ok('正常录制完成回调', first.kind === 'finish', first.kind === 'cancel' ? first.reason : first.kind);
  if (first.kind === 'finish') {
    const r = first.r;
    const gif = Buffer.from(r.gif);
    writeFileSync(out, gif);
    ok('产物是 GIF89a', gif.subarray(0, 6).toString('ascii') === 'GIF89a');
    ok('帧数大于 0', r.frames > 0, `frames=${r.frames}`);
    ok('时长约 2 秒', r.durationMs >= 1500 && r.durationMs <= 3500, `durationMs=${Math.round(r.durationMs)}`);
    ok('尺寸与选区一致', r.width === 320 && r.height === 200, `${r.width}x${r.height}`);
    console.log(`GIF 已写入 ${out}（${gif.length} 字节）`);
  }
  ok('录制结束后不再占用会话', !record.isRecording());

  // 2) 取消路径：开始后立即取消，不产出结果，回调给出原因
  const cancelOnce = () =>
    within(
      new Promise((resolve) => {
        record.startRecording(
          { shot, region, format: 'gif', config },
          { onFinish: () => resolve('finish'), onCancel: resolve },
        );
        setTimeout(() => record.cancelRecording(), 300);
      }),
      10000,
      'timeout',
    );
  const reason = await cancelOnce();
  ok('取消回调携带原因', reason === 'record-cancel', reason);

  // 3) 连续会话：取消之后立刻再开一次，必须仍能正常启动并取消
  const second = await cancelOnce();
  ok('连续会话：第二次仍能启动并取消', second === 'record-cancel', second);

  // 4) MP4：控制条渲染进程用 WebCodecs 编出 H.264，主进程拿到完整 MP4 字节
  const mp4Finished = new Promise((resolve) => {
    const started = record.startRecording(
      { shot, region, format: 'mp4', config, maxDurationMs: 2000 },
      { onFinish: (r) => resolve({ kind: 'finish', r }), onCancel: (reason) => resolve({ kind: 'cancel', reason }) },
    );
    ok('MP4 开始录制', started);
  });
  const mp4Result = await within(mp4Finished, 30000, { kind: 'timeout' });
  ok('MP4 录制完成回调', mp4Result.kind === 'finish', mp4Result.kind === 'cancel' ? mp4Result.reason : mp4Result.kind);
  if (mp4Result.kind === 'finish') {
    const r = mp4Result.r;
    const mp4 = Buffer.from(r.mp4);
    writeFileSync(outMp4, mp4);
    // ftyp 盒紧跟盒长度之后，moov 在 mdat 之前（faststart）也能从前 64 字节里看到
    ok('产物以 ftyp 开头', mp4.subarray(4, 8).toString('ascii') === 'ftyp', mp4.subarray(0, 16).toString('ascii'));
    ok(
      'moov 在 mdat 之前',
      mp4.indexOf('moov') > 0 && (mp4.indexOf('mdat') < 0 || mp4.indexOf('moov') < mp4.indexOf('mdat')),
    );
    ok('含 avc1 采样条目', mp4.indexOf('avc1') > 0);
    ok('MP4 帧数大于 0', r.frames > 0, `frames=${r.frames}`);
    ok('MP4 时长约 2 秒', r.durationMs >= 1500 && r.durationMs <= 3500, `durationMs=${Math.round(r.durationMs)}`);
    ok('MP4 尺寸与选区一致', r.width === 320 && r.height === 200, `${r.width}x${r.height}`);
    console.log(`MP4 已写入 ${outMp4}（${mp4.length} 字节）`);
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? `（${c.detail}）` : ''}`);
  app.exit(failed.length ? 1 : 0);
});
