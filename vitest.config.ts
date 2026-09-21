import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    testTimeout: 15_000,
    // 默认 node 环境；renderer 测试通过文件首行 `// @vitest-environment happy-dom` 切换
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'packages/*/tests/**/*.test.ts', 'packages/*/tests/**/*.test.tsx', 'apps/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.tsx'],
    setupFiles: ['tests/unit/setup.ts', 'tests/setup-renderer.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', 'src/shared/**'],
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
