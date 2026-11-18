import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// 纯逻辑在 node 环境跑；DOM / canvas 相关在真实 Chromium 里跑 ——
// jsdom / happy-dom 都不实现 canvas，编辑器与拼接无法在它们里验证。
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/browser/**'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
