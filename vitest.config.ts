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
    // 默认 node 环境；renderer 测试通过文件首行 `// @vitest-environment happy-dom` 切换
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/unit/setup.ts', 'tests/setup-renderer.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/transports/**/*.ts', 'src/mcp/**/*.ts'],
    },
  },
});
