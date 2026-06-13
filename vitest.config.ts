import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/transports/**/*.ts', 'src/mcp/**/*.ts'],
    },
  },
});
