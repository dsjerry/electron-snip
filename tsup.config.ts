import { copyFile, mkdir } from 'node:fs/promises';
import { defineConfig } from 'tsup';

// 渲染页面的 html 原样复制，脚本与样式由 tsup 产出（同名 .js / .css）
async function copyRendererHtml(): Promise<void> {
  await mkdir('dist/renderer', { recursive: true });
  for (const name of ['overlay', 'pin']) {
    await copyFile(`src/renderer/${name}/${name}.html`, `dist/renderer/${name}.html`);
  }
  // 长图的样式由 html 直接链接，不经过打包器，需要原样复制
  await copyFile('src/renderer/scroll/scroll.html', 'dist/renderer/scroll.html');
  await copyFile('src/renderer/scroll/scroll.css', 'dist/renderer/scroll.css');
  await copyFile('src/renderer/record/record.html', 'dist/renderer/record.html');
  await copyFile('src/renderer/record/record.css', 'dist/renderer/record.css');
}

// `clean` 由 npm 脚本统一做：多个配置并行构建时，各自清理 dist 会互相删产物
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    // 同时产出 ESM 与 CJS：宿主主进程是 CJS 构建，经 require 解析时需要 require 条件
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node24',
    dts: true,
    sourcemap: true,
    external: ['electron'],
  },
  {
    // preload 在沙箱下不能用 ESM import，单独打成 CJS 单文件
    entry: { preload: 'src/preload/index.ts' },
    format: ['cjs'],
    platform: 'node',
    target: 'node24',
    outExtension: () => ({ js: '.cjs' }),
    sourcemap: true,
    external: ['electron'],
  },
  {
    // 渲染页面：IIFE 而非 ESM —— file:// 下 module 脚本受 CORS 限制，经典脚本没有这个问题
    entry: {
      overlay: 'src/renderer/overlay/overlay.ts',
      pin: 'src/renderer/pin/pin.ts',
      scroll: 'src/renderer/scroll/scroll.ts',
      record: 'src/renderer/record/record.ts',
    },
    format: ['iife'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist/renderer',
    outExtension: () => ({ js: '.js' }),
    loader: { '.svg': 'text' },
    sourcemap: true,
    onSuccess: copyRendererHtml,
  },
  {
    // 标注引擎：供宿主的录制控制条等页面复用（浏览器 ESM + 同名 CSS）
    entry: { annotations: 'src/annotations/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist/annotations',
    loader: { '.svg': 'text' },
    sourcemap: true,
    dts: true,
  },
  {
    // 浏览器可用的小工具（子路径 electron-snip/utils）
    entry: { utils: 'src/utils/index.ts' },
    // 主进程（CJS 宿主）也会用到 cropShot 等纯函数，所以同时产出 CJS
    format: ['esm', 'cjs'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist/utils',
    sourcemap: true,
    dts: true,
  },
  {
    // 系统 OCR（子路径 electron-snip/ocr）：主进程用，依赖 electron 的 app 取临时目录
    entry: { ocr: 'src/ocr/index.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node24',
    outDir: 'dist/ocr',
    sourcemap: true,
    dts: true,
    external: ['electron'],
  },
  {
    // 长图（子路径 electron-snip/scroll）：主进程模块，依赖 electron / koffi（Windows 自动滚动）
    entry: { scroll: 'src/scroll/index.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node24',
    outDir: 'dist/scroll',
    sourcemap: true,
    dts: true,
    external: ['electron', 'koffi'],
  },
  {
    // 录制（子路径 electron-snip/record）：主进程模块，依赖 electron 与 koffi（可选）
    entry: { record: 'src/record/index.ts' },
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node24',
    outDir: 'dist/record',
    sourcemap: true,
    dts: true,
    external: ['electron', 'koffi'],
  },
  {
    // MP4 编码（子路径 electron-snip/record/mp4）：纯浏览器可用（WebCodecs），
    // 录制控制条与宿主渲染端共用；与上面的 node 构建同目录，文件名不冲突
    entry: { 'record/mp4': 'src/record/mp4.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    dts: true,
  },
]);
