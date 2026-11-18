import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node24',
    dts: true,
    sourcemap: true,
    clean: true,
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
]);
